// CLI: create a user record.
//
// Intentionally NOT exposed as a public HTTP endpoint. This is a single-
// household backend; account creation happens via this script, never over
// the network. Removes a whole class of attack surface (signup abuse,
// enumeration via uniqueness errors, captcha bypass).
//
// Usage:
//   npm run create-user
// You will be prompted interactively for email, role, and password.

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loadEnv } from '../config/env';
import { getDb, closeDb } from '../db/connection';

const BCRYPT_COST = 12;
const MIN_PASSWORD_LEN = 12;

const emailSchema = z.string().email();
const roleSchema = z.enum(['user', 'admin']);

async function main(): Promise<void> {
  loadEnv(); // fail fast if env is wrong
  const rl = readline.createInterface({ input, output });
  try {
    const emailRaw = (await rl.question('Email: ')).trim().toLowerCase();
    const email = emailSchema.parse(emailRaw);

    const roleRaw = ((await rl.question('Role [user|admin] (default: user): ')).trim() || 'user');
    const role = roleSchema.parse(roleRaw);

    const password = await rl.question(`Password (min ${MIN_PASSWORD_LEN} chars): `);
    if (password.length < MIN_PASSWORD_LEN) {
      throw new Error(`password must be at least ${MIN_PASSWORD_LEN} characters`);
    }

    const db = getDb();
    const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    if (exists) {
      throw new Error(`user already exists: ${email}`);
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO users (id, email, password_hash, role, failed_attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(id, email, passwordHash, role, now, now);

    process.stdout.write(`Created user ${email} (role=${role}, id=${id})\n`);
  } finally {
    rl.close();
    closeDb();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
