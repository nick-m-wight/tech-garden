// Public + authenticated routes.
//
// OWASP references:
//   A01 — every non-public route hangs off requireAuth.
//   A03 — every body parsed through a zod schema.
//   A07 — login uses constant-time bcrypt compare even on unknown user
//         (no user enumeration). Account locks after 10 failed attempts.
//   A09 — every outcome (success / failure / lockout) audited.

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/connection';
import { signAccessToken } from '../auth/jwt';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  RefreshTokenError,
} from '../auth/refresh';
import { requireAuth } from '../auth/middleware';
import { auditLog } from '../audit/logger';
import { loginLimiter, refreshLimiter } from '../ratelimit/limiter';
import { healthRouter } from './healthcheck';
import { loadEnv } from '../config/env';

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_DURATION_SEC = 60 * 60; // 1 hour

// A non-truthy bcrypt hash for the unknown-user codepath. Constant-time
// comparison defeats user enumeration via timing side channel (OWASP A07).
const DUMMY_HASH = '$2a$12$' + 'A'.repeat(53);

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(512),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  failed_attempts: number;
  locked_until: number | null;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

export function buildRoutes(): Router {
  const router = Router();

  // Public — no auth.
  router.use(healthRouter);

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      auditLog({ action: 'login.malformed', ip: req.ip, result: 'failure' });
      res.status(400).json({ error: 'invalid request' });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const db = getDb();
    const row = db
      .prepare(`
        SELECT id, email, password_hash, role, failed_attempts, locked_until
        FROM users WHERE email = ?
      `)
      .get(email) as UserRow | undefined;

    const hash = row?.password_hash ?? DUMMY_HASH;
    const passwordOk = await bcrypt.compare(parsed.data.password, hash);

    if (!row) {
      auditLog({ action: 'login.unknown_user', ip: req.ip, result: 'failure' });
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    if (row.locked_until !== null && row.locked_until > nowSec()) {
      auditLog({
        action: 'login.locked',
        userId: row.id,
        ip: req.ip,
        result: 'denied',
        metadata: { lockedUntil: row.locked_until },
      });
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    if (!passwordOk) {
      const newAttempts = row.failed_attempts + 1;
      const lockUntil = newAttempts >= LOCKOUT_THRESHOLD ? nowSec() + LOCKOUT_DURATION_SEC : null;
      db.prepare(`
        UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?
      `).run(newAttempts, lockUntil, nowSec(), row.id);
      auditLog({
        action: lockUntil !== null ? 'login.locked_out' : 'login.bad_password',
        userId: row.id,
        ip: req.ip,
        result: 'failure',
        metadata: { attempts: newAttempts },
      });
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    db.prepare(`
      UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?
    `).run(nowSec(), row.id);

    const env = loadEnv();
    const accessToken = signAccessToken({ userId: row.id, role: row.role });
    const refresh = await issueRefreshToken(row.id);
    auditLog({ action: 'login.success', userId: row.id, ip: req.ip, result: 'success' });

    res.json({
      accessToken,
      refreshToken: refresh.token,
      accessExpiresIn: env.JWT_ACCESS_EXPIRY,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRY,
    });
  });

  router.post('/auth/refresh', refreshLimiter, async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }
    try {
      const rotated = await rotateRefreshToken(parsed.data.refreshToken);
      const row = getDb()
        .prepare('SELECT role FROM users WHERE id = ?')
        .get(rotated.userId) as { role: string } | undefined;
      if (!row) {
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      const env = loadEnv();
      const accessToken = signAccessToken({ userId: rotated.userId, role: row.role });
      auditLog({
        action: 'token.refresh',
        userId: rotated.userId,
        ip: req.ip,
        result: 'success',
      });
      res.json({
        accessToken,
        refreshToken: rotated.token,
        accessExpiresIn: env.JWT_ACCESS_EXPIRY,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRY,
      });
    } catch (err) {
      if (err instanceof RefreshTokenError) {
        auditLog({
          action: `refresh.${err.reason}`,
          ip: req.ip,
          result: 'denied',
        });
        res.status(401).json({ error: 'invalid credentials' });
        return;
      }
      throw err;
    }
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    const parsed = logoutSchema.safeParse(req.body ?? {});
    if (parsed.success && parsed.data.refreshToken) {
      revokeRefreshToken(parsed.data.refreshToken);
    }
    auditLog({
      action: 'logout',
      userId: req.user?.userId,
      ip: req.ip,
      result: 'success',
    });
    res.json({ status: 'ok' });
  });

  return router;
}
