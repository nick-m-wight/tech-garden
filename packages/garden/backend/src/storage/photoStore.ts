// Encrypted photo storage.
//
// OWASP A02 — AES-256-GCM encryption at rest; IV is random per write; auth tag
//             stored alongside ciphertext so tampering is detected on read.
// OWASP A01 — every read and delete checks userId against the stored owner.
// OWASP A03 — magic bytes validated before encrypting; rejects non-JPEG/PNG.
// OWASP A09 — every write, read, delete, and retention pass is audit-logged.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { loadEnv } from '../../../../base/backend/src/config/env';
import { auditLog, getLogger } from '../../../../base/backend/src/audit/logger';

// ---- Binary file format: [IV (16 B)][authTag (16 B)][ciphertext] ----

const ALGO = 'aes-256-gcm' as const;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const MIN_ENC_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH + 1;

// ---- Magic-byte validation (OWASP A03) ----

export function validateMagicBytes(buf: Buffer): 'image/jpeg' | 'image/png' {
  if (buf.length < 4) {
    throw new Error('Buffer too small to validate image format');
  }
  const b0 = buf.readUInt8(0);
  const b1 = buf.readUInt8(1);
  const b2 = buf.readUInt8(2);
  const b3 = buf.readUInt8(3);
  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png';
  throw new Error('Unsupported image format: must be JPEG or PNG');
}

// ---- AES-256-GCM encryption (OWASP A02) ----

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decrypt(encrypted: Buffer, key: Buffer): Buffer {
  if (encrypted.length < MIN_ENC_LENGTH) {
    throw new Error('Encrypted buffer is too small to be valid');
  }
  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---- Key loading (OWASP A02) ----

function loadEncryptionKey(): Buffer {
  const env = loadEnv();
  const key = Buffer.from(env.PHOTO_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `PHOTO_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256 (got ${key.length})`,
    );
  }
  return key;
}

// ---- DB row types ----

interface PhotoRow {
  id: string;
  user_id: string;
  plant_id: string | null;
  zone_id: string | null;
  file_path: string;
  timestamp: number;
  analysis_id: string | null;
}

export interface PhotoRecord {
  photoId: string;
  userId: string;
  plantId: string | null;
  zoneId: string | null;
  filePath: string;
  timestamp: Date;
  analysisId: string | null;
}

function rowToRecord(row: PhotoRow): PhotoRecord {
  return {
    photoId: row.id,
    userId: row.user_id,
    plantId: row.plant_id,
    zoneId: row.zone_id,
    filePath: row.file_path,
    timestamp: new Date(row.timestamp * 1000),
    analysisId: row.analysis_id,
  };
}

// ---- Write (OWASP A02, A03) ----

export interface SavePhotoParams {
  imageBuffer: Buffer;
  userId: string;
  plantId?: string;
  zoneId?: string;
}

export function savePhoto(db: Database, params: SavePhotoParams): PhotoRecord {
  validateMagicBytes(params.imageBuffer); // OWASP A03

  const key = loadEncryptionKey();
  const photoId = crypto.randomUUID();
  const encrypted = encrypt(params.imageBuffer, key);

  const env = loadEnv();
  const dir = path.join(path.resolve(env.PHOTO_STORAGE_PATH), params.userId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${photoId}.enc`);

  fs.writeFileSync(filePath, encrypted);

  const ts = Math.floor(Date.now() / 1000);
  try {
    db.prepare(
      `INSERT INTO plant_photos
         (id, user_id, plant_id, zone_id, file_path, timestamp, analysis_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      photoId,
      params.userId,
      params.plantId ?? null,
      params.zoneId ?? null,
      filePath,
      ts,
      null,
    );
  } catch (err) {
    // Roll back the file write if the DB insert fails — leave no orphan.
    try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
    auditLog({
      action: 'photo.save',
      userId: params.userId,
      result: 'failure',
      metadata: { reason: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }

  auditLog({
    action: 'photo.save',
    userId: params.userId,
    result: 'success',
    metadata: { photoId, plantId: params.plantId, zoneId: params.zoneId },
  });

  return {
    photoId,
    userId: params.userId,
    plantId: params.plantId ?? null,
    zoneId: params.zoneId ?? null,
    filePath,
    timestamp: new Date(ts * 1000),
    analysisId: null,
  };
}

// ---- Read (OWASP A01, A02) ----

export function loadPhoto(db: Database, photoId: string, userId: string): Buffer {
  // OWASP A01 — userId scoped; returns the same error for "not found" and
  // "wrong user" to avoid revealing which IDs exist.
  const row = db
    .prepare('SELECT * FROM plant_photos WHERE id = ? AND user_id = ?')
    .get(photoId, userId) as PhotoRow | undefined;

  if (!row) {
    auditLog({
      action: 'photo.load',
      userId,
      result: 'denied',
      metadata: { photoId, reason: 'not_found_or_wrong_user' },
    });
    throw new Error(`Photo not found: ${photoId}`);
  }

  const encrypted = fs.readFileSync(row.file_path);
  const key = loadEncryptionKey();
  const decrypted = decrypt(encrypted, key); // OWASP A02

  auditLog({ action: 'photo.load', userId, result: 'success', metadata: { photoId } });
  return decrypted;
}

export function getPhotoRecord(
  db: Database,
  photoId: string,
  userId: string,
): PhotoRecord | null {
  const row = db
    .prepare('SELECT * FROM plant_photos WHERE id = ? AND user_id = ?')
    .get(photoId, userId) as PhotoRow | undefined;
  return row !== undefined ? rowToRecord(row) : null;
}

export function listPhotos(
  db: Database,
  userId: string,
  plantId?: string,
): PhotoRecord[] {
  // OWASP A01 — always scoped to userId
  const rows = plantId
    ? (db
        .prepare('SELECT * FROM plant_photos WHERE user_id = ? AND plant_id = ? ORDER BY timestamp DESC')
        .all(userId, plantId) as PhotoRow[])
    : (db
        .prepare('SELECT * FROM plant_photos WHERE user_id = ? ORDER BY timestamp DESC')
        .all(userId) as PhotoRow[]);
  return rows.map(rowToRecord);
}

// ---- Link analysis result to photo ----

export function linkAnalysisToPhoto(
  db: Database,
  photoId: string,
  userId: string,
  analysisId: string,
): void {
  db.prepare(
    'UPDATE plant_photos SET analysis_id = ? WHERE id = ? AND user_id = ?',
  ).run(analysisId, photoId, userId);
}

// ---- Delete (OWASP A01) ----

export function deletePhoto(db: Database, photoId: string, userId: string): void {
  const row = db
    .prepare('SELECT * FROM plant_photos WHERE id = ? AND user_id = ?')
    .get(photoId, userId) as PhotoRow | undefined;

  if (!row) {
    auditLog({
      action: 'photo.delete',
      userId,
      result: 'denied',
      metadata: { photoId, reason: 'not_found_or_wrong_user' },
    });
    return;
  }

  db.prepare('DELETE FROM plant_photos WHERE id = ? AND user_id = ?').run(photoId, userId);

  if (fs.existsSync(row.file_path)) {
    fs.unlinkSync(row.file_path);
  }

  auditLog({ action: 'photo.delete', userId, result: 'success', metadata: { photoId } });
}

// ---- Retention cron (OWASP A09) ----

// Exported for unit testing without a live env.
export function runRetention(
  db: Database,
  retentionDays: number,
): { deleted: number } {
  const cutoffTs = Math.floor(Date.now() / 1000) - retentionDays * 86400;

  const expired = db
    .prepare(
      'SELECT id, user_id, file_path FROM plant_photos WHERE timestamp < ?',
    )
    .all(cutoffTs) as Array<{ id: string; user_id: string; file_path: string }>;

  let deleted = 0;
  for (const photo of expired) {
    try {
      if (fs.existsSync(photo.file_path)) {
        fs.unlinkSync(photo.file_path);
      }
      db.prepare('DELETE FROM plant_photos WHERE id = ?').run(photo.id);
      auditLog({
        action: 'photo.retention_delete',
        userId: photo.user_id,
        result: 'success',
        metadata: { photoId: photo.id },
      });
      deleted++;
    } catch (err) {
      auditLog({
        action: 'photo.retention_delete',
        userId: photo.user_id,
        result: 'failure',
        metadata: {
          photoId: photo.id,
          reason: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return { deleted };
}

export function startRetentionCron(db: Database): NodeJS.Timeout {
  const INTERVAL_MS = 24 * 60 * 60 * 1000;
  return setInterval(() => {
    const { PHOTO_RETENTION_DAYS } = loadEnv();
    const result = runRetention(db, PHOTO_RETENTION_DAYS);
    getLogger().info({ msg: 'photo.retention_cron', deleted: result.deleted });
  }, INTERVAL_MS);
}
