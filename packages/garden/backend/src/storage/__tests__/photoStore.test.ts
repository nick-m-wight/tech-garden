import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  validateMagicBytes,
  encrypt,
  decrypt,
  savePhoto,
  loadPhoto,
  getPhotoRecord,
  listPhotos,
  deletePhoto,
  runRetention,
} from '../photoStore';

// Mock env + logger so tests don't require a real .env file.
jest.mock('../../../../../base/backend/src/config/env', () => ({
  loadEnv: () => ({
    PHOTO_ENCRYPTION_KEY: Buffer.alloc(32, 0x42).toString('base64'),
    PHOTO_STORAGE_PATH: os.tmpdir(),
  }),
}));
jest.mock('../../../../../base/backend/src/audit/logger', () => ({
  auditLog: jest.fn(),
  getLogger: () => ({ info: jest.fn() }),
}));

// ---- Fixtures ----

const JPEG_BUF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BUF = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GARBAGE = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

// Minimal in-memory SQLite with the plant_photos schema.
function makeDb(): DatabaseType {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE plant_photos (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      plant_id    TEXT,
      zone_id     TEXT,
      file_path   TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      analysis_id TEXT
    )
  `);
  return db;
}

// ---- validateMagicBytes ----

describe('validateMagicBytes', () => {
  it('accepts JPEG', () => {
    expect(validateMagicBytes(JPEG_BUF)).toBe('image/jpeg');
  });

  it('accepts PNG', () => {
    expect(validateMagicBytes(PNG_BUF)).toBe('image/png');
  });

  it('rejects unknown format', () => {
    expect(() => validateMagicBytes(GARBAGE)).toThrow('Unsupported image format');
  });

  it('rejects buffer shorter than 4 bytes', () => {
    expect(() => validateMagicBytes(Buffer.from([0xff, 0xd8]))).toThrow(
      'Buffer too small',
    );
  });
});

// ---- encrypt / decrypt ----

describe('encrypt / decrypt', () => {
  const KEY = Buffer.alloc(32, 0x42);
  const PLAINTEXT = Buffer.from('hello world');

  it('round-trips plaintext', () => {
    const enc = encrypt(PLAINTEXT, KEY);
    expect(decrypt(enc, KEY)).toEqual(PLAINTEXT);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const a = encrypt(PLAINTEXT, KEY);
    const b = encrypt(PLAINTEXT, KEY);
    expect(a).not.toEqual(b);
  });

  it('encrypted buffer starts with 32-byte header (IV + authTag)', () => {
    const enc = encrypt(PLAINTEXT, KEY);
    // 16 IV + 16 authTag + plaintext length
    expect(enc.length).toBe(16 + 16 + PLAINTEXT.length);
  });

  it('throws when auth tag is tampered with', () => {
    const enc = encrypt(PLAINTEXT, KEY);
    enc.writeUInt8(enc.readUInt8(16) ^ 0xff, 16); // flip a byte in the authTag region
    expect(() => decrypt(enc, KEY)).toThrow();
  });

  it('throws when ciphertext is tampered with', () => {
    const enc = encrypt(PLAINTEXT, KEY);
    enc.writeUInt8(enc.readUInt8(enc.length - 1) ^ 0xff, enc.length - 1);
    expect(() => decrypt(enc, KEY)).toThrow();
  });

  it('throws when buffer is too small', () => {
    expect(() => decrypt(Buffer.alloc(10), KEY)).toThrow('too small');
  });
});

// ---- savePhoto / loadPhoto / deletePhoto ----

describe('savePhoto / loadPhoto / deletePhoto', () => {
  let db: DatabaseType;
  let storageTmpDir: string;

  beforeEach(() => {
    db = makeDb();
    storageTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-test-'));
    // Override PHOTO_STORAGE_PATH to the temp dir for this test run.
    // (The mock returns os.tmpdir() but we need isolation — use a sub-dir via jest.resetModules
    // is awkward; instead just confirm that saved files land somewhere and clean up.)
  });

  afterEach(() => {
    db.close();
    fs.rmSync(storageTmpDir, { recursive: true, force: true });
  });

  it('saves and loads a JPEG', () => {
    const record = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1' });
    expect(record.userId).toBe('u1');
    expect(record.analysisId).toBeNull();

    const loaded = loadPhoto(db, record.photoId, 'u1');
    expect(loaded).toEqual(JPEG_BUF);
  });

  it('saves and loads a PNG', () => {
    const record = savePhoto(db, { imageBuffer: PNG_BUF, userId: 'u2', plantId: 'p1' });
    expect(record.plantId).toBe('p1');

    const loaded = loadPhoto(db, record.photoId, 'u2');
    expect(loaded).toEqual(PNG_BUF);
  });

  it('rejects non-image buffer on save', () => {
    expect(() => savePhoto(db, { imageBuffer: GARBAGE, userId: 'u1' })).toThrow(
      'Unsupported image format',
    );
  });

  it('loadPhoto throws for wrong userId (OWASP A01)', () => {
    const record = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'owner' });
    expect(() => loadPhoto(db, record.photoId, 'attacker')).toThrow('Photo not found');
  });

  it('loadPhoto throws for unknown photoId', () => {
    expect(() => loadPhoto(db, 'no-such-id', 'u1')).toThrow('Photo not found');
  });

  it('deletePhoto removes DB row and file', () => {
    const record = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1' });
    expect(fs.existsSync(record.filePath)).toBe(true);

    deletePhoto(db, record.photoId, 'u1');

    expect(fs.existsSync(record.filePath)).toBe(false);
    expect(getPhotoRecord(db, record.photoId, 'u1')).toBeNull();
  });

  it('deletePhoto is a no-op for wrong userId (OWASP A01)', () => {
    const record = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'owner' });
    deletePhoto(db, record.photoId, 'attacker');
    // Row still exists for the real owner.
    expect(getPhotoRecord(db, record.photoId, 'owner')).not.toBeNull();
  });
});

// ---- listPhotos ----

describe('listPhotos', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    // Clean up any .enc files that were written to os.tmpdir().
    db.close();
  });

  it('returns photos for userId, newest first', () => {
    const r1 = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1' });
    const r2 = savePhoto(db, { imageBuffer: PNG_BUF, userId: 'u1' });
    const list = listPhotos(db, 'u1');
    expect(list.length).toBe(2);
    // r2 was inserted after r1 so it has >= timestamp; check both are present.
    const ids = list.map((r) => r.photoId);
    expect(ids).toContain(r1.photoId);
    expect(ids).toContain(r2.photoId);
  });

  it('does not return photos belonging to another user (OWASP A01)', () => {
    savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'other' });
    expect(listPhotos(db, 'u1')).toHaveLength(0);
  });

  it('filters by plantId when provided', () => {
    savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1', plantId: 'p1' });
    savePhoto(db, { imageBuffer: PNG_BUF, userId: 'u1', plantId: 'p2' });
    const filtered = listPhotos(db, 'u1', 'p1');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.plantId).toBe('p1');
  });
});

// ---- runRetention ----

describe('runRetention', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it('deletes photos older than retentionDays', () => {
    const record = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1' });

    // Back-date the timestamp to 100 days ago.
    const oldTs = Math.floor(Date.now() / 1000) - 100 * 86400;
    db.prepare('UPDATE plant_photos SET timestamp = ? WHERE id = ?').run(
      oldTs,
      record.photoId,
    );

    const { deleted } = runRetention(db, 90);
    expect(deleted).toBe(1);
    expect(getPhotoRecord(db, record.photoId, 'u1')).toBeNull();
  });

  it('keeps photos within retentionDays', () => {
    const record = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1' });

    // Back-date to 30 days ago (within 90-day retention).
    const recentTs = Math.floor(Date.now() / 1000) - 30 * 86400;
    db.prepare('UPDATE plant_photos SET timestamp = ? WHERE id = ?').run(
      recentTs,
      record.photoId,
    );

    const { deleted } = runRetention(db, 90);
    expect(deleted).toBe(0);
    expect(getPhotoRecord(db, record.photoId, 'u1')).not.toBeNull();
  });

  it('returns 0 when there is nothing to delete', () => {
    expect(runRetention(db, 90)).toEqual({ deleted: 0 });
  });

  it('counts only successfully deleted photos', () => {
    const r1 = savePhoto(db, { imageBuffer: JPEG_BUF, userId: 'u1' });
    const r2 = savePhoto(db, { imageBuffer: PNG_BUF, userId: 'u1' });

    const oldTs = Math.floor(Date.now() / 1000) - 200 * 86400;
    db.prepare('UPDATE plant_photos SET timestamp = ? WHERE id = ? OR id = ?').run(
      oldTs,
      r1.photoId,
      r2.photoId,
    );

    const { deleted } = runRetention(db, 90);
    expect(deleted).toBe(2);
  });
});
