// SQLite connection + schema bootstrap.
//
// OWASP A03 — every query downstream of this file uses prepared statements
// via better-sqlite3. There is no codepath that interpolates user input into
// SQL strings.
//
// Note: §2 of CLAUDE.md does not enumerate a `db/` module; this file exists
// because tables `users` and `refresh_tokens` (§11) need to be created and
// shared across `auth/` and other modules. Schema for `audit_log` is
// intentionally omitted — §4 A09 stores audit records in date-rotated log
// files, not the DB.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { loadEnv } from '../config/env';
import { getLogger } from '../audit/logger';

const SCHEMA = `
-- CLAUDE.md §11 — users
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,         -- UUIDv4, opaque (OWASP A01)
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,            -- bcryptjs cost 12 (OWASP A02)
  role            TEXT NOT NULL DEFAULT 'user',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER,                  -- epoch seconds, NULL = not locked
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- CLAUDE.md §11 + §4 A07 — single-use refresh tokens, bcrypt-hashed.
-- Token id is opaque; raw token presented as "<id>.<random>" so we can look
-- the row up by id and then bcrypt-compare the random part.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,             -- UUIDv4
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,                -- bcrypt of the random part
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,   -- 0 / 1
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_user      ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_lifecycle ON refresh_tokens(revoked, expires_at);
`;

let cached: DatabaseType | undefined;

export function getDb(): DatabaseType {
  if (cached) return cached;
  const env = loadEnv();
  const dbPath = path.resolve(env.DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');         // crash-safe writes
  db.pragma('foreign_keys = ON');           // enforce FK on refresh_tokens
  db.pragma('synchronous = NORMAL');        // fsync per WAL checkpoint
  db.exec(SCHEMA);

  cached = db;
  getLogger().info({ msg: 'db.connected', path: dbPath });
  return cached;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = undefined;
  }
}

export function __resetDbForTests(): void {
  closeDb();
}
