// A01 — Broken Access Control: all queries must include WHERE user_id = :userId.
// A03 — Injection: drizzle-orm uses parameterised statements; never build SQL strings.
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- Schema ---

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  issuedAt: integer('issued_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
});

// A09 — Security Logging: audit log never leaves the device; never synced to Supabase.
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  ip: text('ip'),
  result: text('result').notNull(),
  metadata: text('metadata'),
  timestamp: integer('timestamp', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- Database instance ---

const sqliteDb = openDatabaseSync('app.db');
export const db = drizzle(sqliteDb);

export function initDb(): void {
  // WAL mode and foreign keys must be set before any queries.
  sqliteDb.execSync(`PRAGMA journal_mode = WAL;`);
  sqliteDb.execSync(`PRAGMA foreign_keys = ON;`);

  sqliteDb.execSync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      issued_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      result TEXT NOT NULL,
      metadata TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
