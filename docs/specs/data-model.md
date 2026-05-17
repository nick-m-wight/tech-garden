# Local-First Data Model (SQLite / drizzle-orm)

## Tables

```
-- Core tables (base)
users         { id, email, passwordHash, createdAt, role }
refreshTokens { id, userId, tokenHash, issuedAt, expiresAt, revoked }
auditLog      { id, userId, action, ip, result, metadata, timestamp }

-- Garden tables (garden)
plants        { id, userId, name, species, zoneId, createdAt, notes }
gardenZones   { id, userId, name, sensorConfig, actuatorConfig }
plantPhotos   { id, userId, plantId, zoneId, filePath, timestamp, analysisId }
analyses      { id, photoId, userId, diagnosis, recommendations, spokenSummary, rawResponse, createdAt }
sensorHistory { id, zoneId, userId, sensorType, value, unit, recordedAt }
```

## Cloud sync — Supabase (opt-in)

Supabase is opt-in. When disabled the app is fully functional offline. Never initialise the Supabase client unless the user has explicitly enabled sync.

```typescript
// base/mobile/src/sync/cloudSync.ts
// Sync strategy: local SQLite is source of truth.
// On sync: push local rows with updatedAt > lastSyncedAt to Supabase.
// On pull: fetch remote rows with updatedAt > lastSyncedAt, merge into local DB.
// Conflict resolution: last-write-wins on updatedAt timestamp.
// Never sync: auditLog (stays local only), refreshTokens, passwordHash fields.

interface SyncProvider {
  isEnabled(): boolean;
  push(table: string, records: SyncRecord[]): Promise<void>;
  pull(table: string, since: Date): Promise<SyncRecord[]>;
  uploadPhoto(photoId: string, encryptedBuffer: Buffer): Promise<string>;
  deletePhoto(storageUrl: string): Promise<void>;
}
```

### Supabase tables
Mirror local SQLite schema — add `user_id` RLS column to each:
`plants`, `garden_zones`, `plant_photos` (metadata only), `analyses`, `sensor_history`

### RLS policy (OWASP A01)
Row-Level Security MUST be enabled on every Supabase table.
Policy: `auth.uid() = user_id` — users can only access their own rows.

### Env vars required
```
SUPABASE_URL=
SUPABASE_ANON_KEY=       # safe for mobile
SUPABASE_SERVICE_KEY=    # backend only — NEVER in mobile app
```
