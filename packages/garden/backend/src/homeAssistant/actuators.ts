// Actuator commands via HA REST API.
//
// OWASP A01 — command validated against PERMITTED_COMMANDS whitelist; entity ID
//             validated against per-user zone whitelist before every HA service call.
// OWASP A03 — entity ID format validated before use.
// OWASP A09 — every command attempt, success or failure, is audit-logged.

import type { Database } from 'better-sqlite3';
import { HAClient, isValidEntityId } from './client';
import { getUserEntityWhitelist } from './zones';
import { auditLog } from '../../../../base/backend/src/audit/logger';

export const PERMITTED_COMMANDS = [
  'turn_on_water',
  'turn_off_water',
  'turn_on_light',
  'turn_off_light',
  'turn_on_fan',
  'turn_off_fan',
  'turn_on_heater',
  'turn_off_heater',
  'read_sensor', // handled by sensors.ts; listed here for intent-parser completeness
] as const;

export type PermittedCommand = (typeof PERMITTED_COMMANDS)[number];

type CommandTarget = { domain: string; service: string };

// Maps each command to its HA service call. read_sensor is null — not an actuator.
const COMMAND_MAP: Record<PermittedCommand, CommandTarget | null> = {
  turn_on_water:   { domain: 'switch', service: 'turn_on' },
  turn_off_water:  { domain: 'switch', service: 'turn_off' },
  turn_on_light:   { domain: 'light',  service: 'turn_on' },
  turn_off_light:  { domain: 'light',  service: 'turn_off' },
  turn_on_fan:     { domain: 'switch', service: 'turn_on' },
  turn_off_fan:    { domain: 'switch', service: 'turn_off' },
  turn_on_heater:  { domain: 'switch', service: 'turn_on' },
  turn_off_heater: { domain: 'switch', service: 'turn_off' },
  read_sensor:     null,
};

export async function executeCommand(
  client: HAClient,
  db: Database,
  command: PermittedCommand,
  entityId: string,
  userId: string,
  zoneId: string,
): Promise<void> {
  // Validate entity ID format (OWASP A03)
  if (!isValidEntityId(entityId)) {
    auditLog({
      action: 'ha.command',
      userId,
      result: 'failure',
      metadata: { command, entityId, zoneId, reason: 'invalid_entity_id_format' },
    });
    throw new Error(`Invalid entity ID format: '${entityId}'`);
  }

  // Validate against user's zone whitelist (OWASP A01)
  const whitelist = getUserEntityWhitelist(db, userId);
  if (!whitelist.has(entityId)) {
    auditLog({
      action: 'ha.command',
      userId,
      result: 'denied',
      metadata: { command, entityId, zoneId, reason: 'not_in_user_whitelist' },
    });
    throw new Error(
      `Entity '${entityId}' is not configured in any of this user's zones`,
    );
  }

  const target = COMMAND_MAP[command];
  if (target === null) {
    auditLog({
      action: 'ha.command',
      userId,
      result: 'failure',
      metadata: { command, entityId, zoneId, reason: 'not_an_actuator_command' },
    });
    throw new Error(
      `'${command}' is not an actuator command — use readSensor() for sensor reads`,
    );
  }

  await client.callService(target.domain, target.service, { entity_id: entityId });

  auditLog({
    action: 'ha.command',
    userId,
    result: 'success',
    metadata: { command, entityId, zoneId, domain: target.domain, service: target.service },
  });
}
