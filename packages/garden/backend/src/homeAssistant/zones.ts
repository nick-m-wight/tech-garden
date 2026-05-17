// Garden zone model — types, zod validation, and DB CRUD.
//
// OWASP A01 — every query is scoped to userId; no cross-user data access is possible.
// OWASP A03 — entity IDs validated against HA format via zod before persisting.

import { z } from 'zod';
import type { Database } from 'better-sqlite3';

const optionalEntityId = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'Must be a valid HA entity_id (domain.name)')
  .optional();

export const GardenZoneSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().min(1).max(100),
  sensors: z.object({
    soilMoisture: optionalEntityId,
    temperature: optionalEntityId,
    humidity: optionalEntityId,
    lightLevel: optionalEntityId,
    pH: optionalEntityId,
    npk: optionalEntityId,
    rain: optionalEntityId,
  }),
  actuators: z.object({
    waterValve: optionalEntityId,
    growLight: optionalEntityId,
    fan: optionalEntityId,
    heater: optionalEntityId,
  }),
});

export type GardenZone = z.infer<typeof GardenZoneSchema>;

interface ZoneRow {
  id: string;
  user_id: string;
  name: string;
  sensor_config: string;
  actuator_config: string;
  created_at: number;
  updated_at: number;
}

function rowToZone(row: ZoneRow): GardenZone {
  return GardenZoneSchema.parse({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    sensors: JSON.parse(row.sensor_config) as Record<string, unknown>,
    actuators: JSON.parse(row.actuator_config) as Record<string, unknown>,
  });
}

// OWASP A01 — userId always scoped in every query
export function getZonesByUserId(db: Database, userId: string): GardenZone[] {
  const rows = db
    .prepare('SELECT * FROM garden_zones WHERE user_id = ?')
    .all(userId) as ZoneRow[];
  return rows.map(rowToZone);
}

export function getZoneById(
  db: Database,
  zoneId: string,
  userId: string,
): GardenZone | null {
  const row = db
    .prepare('SELECT * FROM garden_zones WHERE id = ? AND user_id = ?')
    .get(zoneId, userId) as ZoneRow | undefined;
  return row !== undefined ? rowToZone(row) : null;
}

export function createZone(
  db: Database,
  zone: GardenZone,
): GardenZone {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO garden_zones
       (id, user_id, name, sensor_config, actuator_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    zone.id,
    zone.userId,
    zone.name,
    JSON.stringify(zone.sensors),
    JSON.stringify(zone.actuators),
    now,
    now,
  );
  // Safe: we just inserted this row, it must exist.
  return getZoneById(db, zone.id, zone.userId) as GardenZone;
}

export function updateZone(
  db: Database,
  zoneId: string,
  userId: string,
  updates: Partial<Pick<GardenZone, 'name' | 'sensors' | 'actuators'>>,
): GardenZone | null {
  const existing = getZoneById(db, zoneId, userId);
  if (!existing) return null;

  const merged: GardenZone = {
    ...existing,
    ...updates,
  };
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE garden_zones
     SET name = ?, sensor_config = ?, actuator_config = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    merged.name,
    JSON.stringify(merged.sensors),
    JSON.stringify(merged.actuators),
    now,
    zoneId,
    userId,
  );
  return getZoneById(db, zoneId, userId);
}

export function deleteZone(db: Database, zoneId: string, userId: string): boolean {
  const result = db
    .prepare('DELETE FROM garden_zones WHERE id = ? AND user_id = ?')
    .run(zoneId, userId);
  return result.changes > 0;
}

// Returns the full set of HA entity IDs this user is permitted to access.
// Used by sensors.ts and actuators.ts to enforce the whitelist (OWASP A01).
export function getUserEntityWhitelist(db: Database, userId: string): Set<string> {
  const zones = getZonesByUserId(db, userId);
  const ids = new Set<string>();
  for (const zone of zones) {
    for (const id of Object.values(zone.sensors)) {
      if (id !== undefined) ids.add(id);
    }
    for (const id of Object.values(zone.actuators)) {
      if (id !== undefined) ids.add(id);
    }
  }
  return ids;
}
