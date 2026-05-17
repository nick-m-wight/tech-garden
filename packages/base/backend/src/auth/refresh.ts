// Refresh token issue / rotate / revoke.
//
// OWASP A02 + A07:
//   - Raw token = "<rowId>.<32 random bytes base64url>". Looking up by rowId
//     avoids scanning every row with bcrypt.compare.
//   - Only the bcrypt hash of the random part is stored.
//   - Single-use: rotate revokes the presented token and issues a fresh one
//     atomically.
//   - Reuse detection: presenting an already-revoked-but-otherwise-valid
//     token revokes every active token for that user (theft response).

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/connection';
import { loadEnv } from '../config/env';
import { auditLog } from '../audit/logger';

const BCRYPT_COST = 12;

export interface IssuedRefreshToken {
  id: string;
  token: string;          // raw — returned to the client ONCE
  expiresAt: number;
}

export type RefreshFailReason = 'malformed' | 'not_found' | 'expired' | 'mismatch' | 'reused';

export class RefreshTokenError extends Error {
  constructor(public readonly reason: RefreshFailReason) {
    super(`refresh token: ${reason}`);
    this.name = 'RefreshTokenError';
  }
}

interface RefreshRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  revoked: number;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);
const randomPart = (): string => crypto.randomBytes(32).toString('base64url');
const uuid = (): string => crypto.randomUUID();

export async function issueRefreshToken(userId: string): Promise<IssuedRefreshToken> {
  const env = loadEnv();
  const db = getDb();
  const id = uuid();
  const raw = randomPart();
  const tokenHash = await bcrypt.hash(raw, BCRYPT_COST);
  const issuedAt = nowSec();
  const expiresAt = issuedAt + env.JWT_REFRESH_EXPIRY;

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at, revoked)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, userId, tokenHash, issuedAt, expiresAt);

  return { id, token: `${id}.${raw}`, expiresAt };
}

export async function rotateRefreshToken(presented: string): Promise<IssuedRefreshToken & { userId: string }> {
  const env = loadEnv();
  const db = getDb();

  const dot = presented.indexOf('.');
  if (dot < 1 || dot === presented.length - 1) {
    throw new RefreshTokenError('malformed');
  }
  const id = presented.slice(0, dot);
  const raw = presented.slice(dot + 1);

  const row = db
    .prepare(`
      SELECT id, user_id AS userId, token_hash AS tokenHash, expires_at AS expiresAt, revoked
      FROM refresh_tokens WHERE id = ?
    `)
    .get(id) as RefreshRow | undefined;

  if (!row) throw new RefreshTokenError('not_found');

  if (row.revoked === 1) {
    revokeAllForUser(row.userId);
    auditLog({
      action: 'refresh.reuse_detected',
      userId: row.userId,
      result: 'denied',
      metadata: { tokenId: id },
    });
    throw new RefreshTokenError('reused');
  }

  if (row.expiresAt <= nowSec()) throw new RefreshTokenError('expired');

  const ok = await bcrypt.compare(raw, row.tokenHash);
  if (!ok) throw new RefreshTokenError('mismatch');

  const newId = uuid();
  const newRaw = randomPart();
  const newHash = await bcrypt.hash(newRaw, BCRYPT_COST);
  const newExpiresAt = nowSec() + env.JWT_REFRESH_EXPIRY;

  const tx = db.transaction(() => {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(id);
    db.prepare(`
      INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at, revoked)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(newId, row.userId, newHash, nowSec(), newExpiresAt);
  });
  tx();

  return { id: newId, token: `${newId}.${newRaw}`, expiresAt: newExpiresAt, userId: row.userId };
}

export function revokeRefreshToken(presented: string): void {
  const dot = presented.indexOf('.');
  const id = dot > 0 ? presented.slice(0, dot) : presented;
  getDb().prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0').run(id);
}

export function revokeAllForUser(userId: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(userId);
}

export function cleanupExpiredRefreshTokens(): number {
  const result = getDb().prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(nowSec());
  return result.changes;
}
