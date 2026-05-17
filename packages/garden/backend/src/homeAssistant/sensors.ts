// Sensor reading via HA REST API.
//
// OWASP A01 — entity ID validated against per-user whitelist before every HA call.
// OWASP A03 — entity ID format validated before use.
// OWASP A09 — every sensor read, success or failure, is audit-logged.

import type { Database } from 'better-sqlite3';
import { HAClient, isValidEntityId } from './client';
import { getUserEntityWhitelist } from './zones';
import { auditLog } from '../../../../base/backend/src/audit/logger';

export interface SensorReading {
  entityId: string;
  value: string;
  unit: string | undefined;
  recordedAt: Date;
}

export async function readSensor(
  client: HAClient,
  db: Database,
  entityId: string,
  userId: string,
  zoneId: string,
): Promise<SensorReading> {
  // Validate format before touching the DB or network (OWASP A03)
  if (!isValidEntityId(entityId)) {
    auditLog({
      action: 'ha.sensor_read',
      userId,
      result: 'failure',
      metadata: { entityId, zoneId, reason: 'invalid_entity_id_format' },
    });
    throw new Error(`Invalid entity ID format: '${entityId}'`);
  }

  // Validate against user's zone whitelist (OWASP A01)
  const whitelist = getUserEntityWhitelist(db, userId);
  if (!whitelist.has(entityId)) {
    auditLog({
      action: 'ha.sensor_read',
      userId,
      result: 'denied',
      metadata: { entityId, zoneId, reason: 'not_in_user_whitelist' },
    });
    throw new Error(
      `Entity '${entityId}' is not configured in any of this user's zones`,
    );
  }

  const state = await client.getState(entityId);

  const unit =
    typeof state.attributes['unit_of_measurement'] === 'string'
      ? state.attributes['unit_of_measurement']
      : undefined;

  auditLog({
    action: 'ha.sensor_read',
    userId,
    result: 'success',
    metadata: { entityId, zoneId, value: state.state, unit },
  });

  return {
    entityId: state.entity_id,
    value: state.state,
    unit,
    recordedAt: new Date(),
  };
}
