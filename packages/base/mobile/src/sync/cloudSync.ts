// A01 — Broken Access Control: Supabase tables must have Row-Level Security enabled.
// Cloud sync is opt-in. The local SQLite DB is always the source of truth.
// Full Supabase implementation is wired up at §16 step 11.
import { env } from '../config/env';

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

// No-op provider used when the user has not opted into cloud sync.
class DisabledSyncProvider implements SyncProvider {
  isEnabled(): boolean {
    return false;
  }

  async push(_table: string, _records: SyncRecord[]): Promise<void> {}

  async pull(_table: string, _since: Date): Promise<SyncRecord[]> {
    return [];
  }

  async uploadPhoto(_photoId: string, _encryptedBuffer: Uint8Array): Promise<string> {
    throw new Error('Cloud sync is not enabled.');
  }

  async deletePhoto(_storageUrl: string): Promise<void> {}
}

// Returns the active sync provider.
// When the user enables cloud sync (step 11), swap in the SupabaseSyncProvider here.
export function getSyncProvider(): SyncProvider {
  if (!env.cloudSyncEnabled) {
    return new DisabledSyncProvider();
  }
  // SupabaseSyncProvider is implemented at §16 step 11.
  return new DisabledSyncProvider();
}

export const syncProvider = getSyncProvider();
