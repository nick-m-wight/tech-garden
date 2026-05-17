// Garden-specific DB schema, bootstrapped on top of the base tables.
//
// Call getGardenDb() instead of getDb() anywhere in garden code — it
// guarantees the garden tables exist before returning the connection.
//
// OWASP A03 — no user input reaches these DDL statements.

import type { Database } from 'better-sqlite3';
import { getDb } from '../../../../base/backend/src/db/connection';

// §11 garden tables (CLAUDE.md)
const GARDEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS garden_zones (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  sensor_config   TEXT NOT NULL DEFAULT '{}',
  actuator_config TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_garden_zones_user ON garden_zones(user_id);

CREATE TABLE IF NOT EXISTS plants (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  species    TEXT,
  zone_id    TEXT,
  notes      TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (zone_id) REFERENCES garden_zones(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plants_user ON plants(user_id);

CREATE TABLE IF NOT EXISTS plant_photos (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  plant_id    TEXT,
  zone_id     TEXT,
  file_path   TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  analysis_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL,
  FOREIGN KEY (zone_id) REFERENCES garden_zones(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_user  ON plant_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_plant ON plant_photos(plant_id);

CREATE TABLE IF NOT EXISTS analyses (
  id              TEXT PRIMARY KEY,
  photo_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  diagnosis       TEXT NOT NULL,
  recommendations TEXT NOT NULL,
  spoken_summary  TEXT NOT NULL,
  raw_response    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES plant_photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analyses_user  ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_photo ON analyses(photo_id);

CREATE TABLE IF NOT EXISTS sensor_history (
  id          TEXT PRIMARY KEY,
  zone_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT,
  recorded_at INTEGER NOT NULL,
  FOREIGN KEY (zone_id)  REFERENCES garden_zones(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sensor_history_zone ON sensor_history(zone_id, recorded_at);
`;

let gardenInitialized = false;

export function getGardenDb(): Database {
  const db = getDb();
  if (!gardenInitialized) {
    db.exec(GARDEN_SCHEMA);
    gardenInitialized = true;
  }
  return db;
}

export function __resetGardenDbForTests(): void {
  gardenInitialized = false;
}
