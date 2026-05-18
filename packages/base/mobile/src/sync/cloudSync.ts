// A01 — Supabase tables MUST have RLS enabled: policy `auth.uid() = user_id`.
// A02 — photos are AES-256-GCM encrypted before reaching uploadPhoto; bytes stored as-is.
// A09 — auditLog, refreshTokens, and passwordHash fields must NEVER be passed to push().
// Cloud sync is opt-in. The local SQLite DB is always the source of truth.

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { env } from '../config/env';

// ---- Types ----

export interface SyncRecord {
  id: string;
  updatedAt: Date;
  [key: string]: unknown;
}

export interface SyncProvider {
  isEnabled(): boolean;
  push(table: string, records: SyncRecord[]): Promise<void>;
  pull(table: string, since: Date): Promise<SyncRecord[]>;
  uploadPhoto(photoId: string, encryptedBuffer: Uint8Array): Promise<string>;
  deletePhoto(storageUrl: string): Promise<void>;
}

// ---- Syncable tables ----
// auditLog, refreshTokens, and users.passwordHash stay local only (A09).

export const SYNCABLE_TABLES = [
  'plants',
  'garden_zones',
  'plant_photos',
  'analyses',
  'sensor_history',
] as const;

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

// ---- TableAccessor — contract for callers that own the local SQLite ----

export interface TableAccessor {
  getRowsSince(table: SyncableTable, since: Date): Promise<SyncRecord[]>;
  upsertRows(table: SyncableTable, rows: SyncRecord[]): Promise<void>;
}

// ---- DisabledSyncProvider — returned when user has not opted in ----

class DisabledSyncProvider implements SyncProvider {
  isEnabled(): boolean { return false; }
  async push(_table: string, _records: SyncRecord[]): Promise<void> {}
  async pull(_table: string, _since: Date): Promise<SyncRecord[]> { return []; }
  async uploadPhoto(_photoId: string, _encryptedBuffer: Uint8Array): Promise<string> {
    throw new Error('Cloud sync is not enabled.');
  }
  async deletePhoto(_storageUrl: string): Promise<void> {}
}

// ---- SupabaseSyncProvider ----

const PHOTO_BUCKET = 'garden-photos';
const PHOTO_URL_MARKER = `/storage/v1/object/public/${PHOTO_BUCKET}/`;

class SupabaseSyncProvider implements SyncProvider {
  private readonly client: ReturnType<typeof createClient>;

  constructor(url: string, anonKey: string) {
    // persistSession=false — JWT lifecycle is managed by tokenStore, not Supabase SDK.
    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
  }

  isEnabled(): boolean { return true; }

  async push(table: string, records: SyncRecord[]): Promise<void> {
    if (records.length === 0) return;
    const rows = records.map(({ updatedAt, ...rest }) => ({
      ...rest,
      updated_at: updatedAt.toISOString(),
    }));
    const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`Supabase push [${table}]: ${error.message}`);
  }

  async pull(table: string, since: Date): Promise<SyncRecord[]> {
    const { data, error } = await this.client
      .from(table)
      .select('*')
      .gt('updated_at', since.toISOString());
    if (error) throw new Error(`Supabase pull [${table}]: ${error.message}`);
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((row) => ({
      ...row,
      id: String(row['id']),
      updatedAt: new Date(String(row['updated_at'])),
    }));
  }

  async uploadPhoto(photoId: string, encryptedBuffer: Uint8Array): Promise<string> {
    const path = `photos/${photoId}.enc`;
    const { error } = await this.client.storage
      .from(PHOTO_BUCKET)
      .upload(path, encryptedBuffer, { contentType: 'application/octet-stream', upsert: true });
    if (error) throw new Error(`Supabase photo upload: ${error.message}`);
    const { data } = this.client.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async deletePhoto(storageUrl: string): Promise<void> {
    const idx = storageUrl.indexOf(PHOTO_URL_MARKER);
    if (idx === -1) return;
    const path = storageUrl.slice(idx + PHOTO_URL_MARKER.length);
    if (!path) return;
    const { error } = await this.client.storage.from(PHOTO_BUCKET).remove([path]);
    if (error) throw new Error(`Supabase photo delete: ${error.message}`);
  }
}

// ---- Sync state helpers ----

const LAST_SYNC_KEY_PREFIX = 'cloud_sync_last_';

export async function getLastSyncedAt(table: SyncableTable): Promise<Date> {
  const stored = await SecureStore.getItemAsync(LAST_SYNC_KEY_PREFIX + table);
  return stored !== null ? new Date(stored) : new Date(0);
}

async function setLastSyncedAt(table: SyncableTable, date: Date): Promise<void> {
  await SecureStore.setItemAsync(LAST_SYNC_KEY_PREFIX + table, date.toISOString());
}

// ---- runSync ----
// Pushes local rows to Supabase and merges remote rows into the local DB for all
// SYNCABLE_TABLES. Conflict resolution: last-write-wins on updatedAt.
// Call on app foreground or on explicit user action when cloudSyncEnabled.

export async function runSync(accessor: TableAccessor): Promise<void> {
  const provider = getSyncProvider();
  if (!provider.isEnabled()) return;

  const now = new Date();
  for (const table of SYNCABLE_TABLES) {
    const since = await getLastSyncedAt(table);

    const localRows = await accessor.getRowsSince(table, since);
    await provider.push(table, localRows);

    const remoteRows = await provider.pull(table, since);
    if (remoteRows.length > 0) {
      await accessor.upsertRows(table, remoteRows);
    }

    await setLastSyncedAt(table, now);
  }
}

// ---- Provider factory ----

export function getSyncProvider(): SyncProvider {
  if (env.cloudSyncEnabled && env.supabaseUrl !== undefined && env.supabaseAnonKey !== undefined) {
    return new SupabaseSyncProvider(env.supabaseUrl, env.supabaseAnonKey);
  }
  return new DisabledSyncProvider();
}

export const syncProvider = getSyncProvider();
