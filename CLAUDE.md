# Smart Glasses Project — Claude Code Specification
## base (template) + garden (garden expert app)

> Read this entire file before writing a single line of code.
> This file is the source of truth for architecture, security, and conventions.
>
> **Status (2026-05-16):** §16 steps 1–3 complete (monorepo skeleton, base backend with
> auth/audit/db, MentraOS AppServer base). **Next: step 4 — Expo mobile scaffold.**

---

## 1. PROJECT OVERVIEW

### base
A reusable, secure template for building MentraOS smart glasses applications.
Every future app is forked from this base. It handles:
- Glasses ↔ Backend WebSocket session management (MentraOS SDK)
- JWT authentication with refresh token rotation
- React Native phone app scaffold (Android + iOS from day one)
- Local-first SQLite storage with optional Supabase cloud sync (user opt-in)
- OWASP Top 10 mitigations applied by default
- Dev/prod environment separation (Docker + .env + feature flags)
- Full audit logging
- Rate limiting on all endpoints

### garden
Built on top of base. Adds:
- Garden Expert AI persona (Claude claude-sonnet-4-20250514 with Vision)
- Plant disease, pest, and health recognition via glasses camera
- Annotated photo display on the phone app
- Home Assistant multi-zone sensor reading and actuator control
- Encrypted on-device plant history with optional Supabase cloud sync
- Proactive garden alerts spoken through glasses speakers

---

## 2. MONOREPO STRUCTURE

```
tech-garden/
├── CLAUDE.md                    ← this file
├── .env.example                 ← template, never commit real secrets
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── .github/
│   └── workflows/
│       ├── ci-dev.yml
│       └── ci-prod.yml
│
├── packages/
│   ├── base/             ← TEMPLATE PACKAGE (never modify directly in garden)
│   │   ├── backend/             ← TypeScript strict, Node.js + Express + WebSocket
│   │   │   ├── src/
│   │   │   │   ├── app.ts
│   │   │   │   ├── config/
│   │   │   │   │   ├── env.ts           ← typed env loader, throws on missing vars
│   │   │   │   │   └── features.ts      ← feature flags (dev-only features blocked in prod)
│   │   │   │   ├── auth/
│   │   │   │   │   ├── jwt.ts           ← sign/verify, short expiry (15min access, 7d refresh)
│   │   │   │   │   ├── refresh.ts       ← refresh token rotation + invalidation
│   │   │   │   │   └── middleware.ts    ← Express auth middleware
│   │   │   │   ├── glasses/
│   │   │   │   │   ├── session.ts       ← MentraOS AppServer base class
│   │   │   │   │   └── events.ts        ← transcription, button, photo, location handlers
│   │   │   │   ├── api/
│   │   │   │   │   ├── routes.ts        ← all Express routes registered here
│   │   │   │   │   └── healthcheck.ts
│   │   │   │   ├── audit/
│   │   │   │   │   └── logger.ts        ← structured audit log (all commands, auth events, AI calls)
│   │   │   │   ├── ratelimit/
│   │   │   │   │   └── limiter.ts       ← per-route rate limits using express-rate-limit
│   │   │   │   └── security/
│   │   │   │       ├── helmet.ts        ← HTTP security headers
│   │   │   │       ├── cors.ts          ← strict CORS, whitelist only
│   │   │   │       ├── sanitize.ts      ← input sanitization (DOMPurify-server equiv)
│   │   │   │       └── secrets.ts       ← secret loading, never logs secrets
│   │   │   ├── tsconfig.json            ← strict: true, no implicit any
│   │   │   └── package.json
│   │   │
│   │   └── mobile/              ← React Native (Expo SDK, Android-first)
│   │       ├── src/
│   │       │   ├── app/
│   │       │   │   ├── _layout.tsx
│   │       │   │   └── index.tsx
│   │       │   ├── components/
│   │       │   ├── hooks/
│   │       │   ├── store/
│   │       │   │   └── db.ts            ← SQLite local-first store (expo-sqlite)
│   │       │   ├── sync/
│   │       │   │   └── cloudSync.ts     ← opt-in cloud sync abstraction
│   │       │   ├── auth/
│   │       │   │   └── tokenStore.ts    ← secure token storage (expo-secure-store)
│   │       │   └── config/
│   │       │       └── env.ts           ← typed env for mobile
│   │       ├── app.json
│   │       └── package.json
│   │
│   └── garden/           ← GARDEN APP (extends base)
│       ├── backend/
│       │   └── src/
│       │       ├── ai/
│       │       │   ├── plantAnalysis.ts     ← Claude Vision: disease, pest, health
│       │       │   ├── gardenExpert.ts      ← system prompt + conversation context
│       │       │   └── imageAnnotation.ts   ← trimming/care overlays for phone display
│       │       ├── homeAssistant/
│       │       │   ├── client.ts            ← HA REST API client (typed)
│       │       │   ├── zones.ts             ← multi-zone model
│       │       │   ├── sensors.ts           ← read soil, temp, humidity, pH, NPK, light, rain
│       │       │   └── actuators.ts         ← water valves, lights, fans, heating
│       │       ├── storage/
│       │       │   ├── plantHistory.ts      ← encrypted plant records
│       │       │   └── photoStore.ts        ← encrypted image storage + retention
│       │       └── glasses/
│       │           └── gardenSession.ts     ← garden-specific glasses session (extends base)
│       └── mobile/
│           └── src/
│               ├── screens/
│               │   ├── GardenDashboard.tsx
│               │   ├── PlantAnalysis.tsx        ← annotated photo display
│               │   ├── ZoneMap.tsx
│               │   └── PlantHistory.tsx
│               └── components/
│                   ├── AnnotatedImage.tsx        ← overlays AI annotations on photo
│                   └── SensorCard.tsx
│
└── infra/
    ├── nginx/
    │   └── nginx.conf           ← reverse proxy, TLS termination
    └── scripts/
        ├── generate-secrets.sh  ← generates strong secrets for .env files
        └── rotate-keys.sh       ← JWT key rotation script
```

---

## 3. TECHNOLOGY STACK

### Backend
| Concern | Package | Reason |
|---|---|---|
| Runtime | Node.js 20 LTS | LTS = security patches guaranteed |
| Language | TypeScript 5.x (strict) | Catches type-coercion injection bugs at compile time |
| Framework | Express 4.x | Mature, well-audited |
| Glasses SDK | @mentra/sdk | MentraOS official SDK |
| AI | @anthropic-ai/sdk (claude-sonnet-4-20250514) | Vision + language in one model |
| Auth | jsonwebtoken + bcryptjs | Industry standard |
| Rate limiting | express-rate-limit + rate-limit-redis | Per-route, per-user limits |
| Input validation | zod | Schema validation on all inputs |
| Security headers | helmet | OWASP headers out of the box |
| Audit logging | winston + winston-daily-rotate-file | Structured, rotating logs |
| DB (backend) | SQLite (better-sqlite3) or Postgres | SQLite for Pi, Postgres if scaling |
| Encryption | Node.js crypto (AES-256-GCM) | Built-in, no extra deps for photo encryption |
| HTTP client (HA) | axios with timeout + retry | Typed HA REST client |

### Mobile (React Native)
| Concern | Package | Reason |
|---|---|---|
| Framework | Expo SDK 51+ (managed workflow) | Android + iOS from day one, OTA updates, EAS Build |
| Navigation | Expo Router v3 | File-based, type-safe, works on both platforms |
| Local DB | expo-sqlite + drizzle-orm | Local-first, type-safe queries, offline capable |
| Secure storage | expo-secure-store | Android Keystore + iOS Secure Enclave backed |
| Cloud sync | @supabase/supabase-js (off by default) | User opts in; Postgres + Storage + row-level security |
| Image display | react-native-reanimated + @shopify/react-native-skia | Smooth annotation overlays, both platforms |
| State | Zustand | Lightweight, no boilerplate |
| Network | TanStack Query | Caching, retry, background sync |
| Platform note | Use `Platform.OS` checks sparingly — prefer cross-platform APIs | Avoid platform-specific code unless unavoidable |

---

## 4. SECURITY — OWASP TOP 10 IMPLEMENTATION

Implement every item below. Do not skip any. Comments in code must reference the OWASP item number.

### A01 — Broken Access Control
- Every API route requires valid JWT. No exceptions except `/auth/login` and `/health`.
- JWT payload includes `userId` and `role`. Role checked on every protected route.
- Users can only access their own plant data. Add `WHERE userId = :userId` to every DB query.
- Home Assistant commands validated against a user's permitted zones only.
- No direct object references in URLs (use opaque UUIDs, never sequential IDs).

### A02 — Cryptographic Failures
- All plant photos encrypted at rest with AES-256-GCM before writing to disk.
- Encryption key stored in `.env`, never hardcoded, never logged.
- JWT signed with RS256 (asymmetric) — private key on server, public key distributed.
- Refresh tokens are hashed (bcrypt) before storing in DB. Raw token never stored.
- HTTPS only in prod. Enforce via nginx + HSTS header.
- Secrets never appear in logs (redact middleware on logger).

### A03 — Injection
- All DB queries use parameterised statements (never string concatenation).
- All user inputs validated and typed with `zod` schemas before use.
- Home Assistant entity IDs validated against a whitelist before being sent to HA API.
- AI prompts sanitized — user speech transcriptions stripped of prompt injection patterns before being appended to Claude context.
- Image file uploads validated: check magic bytes, not just extension. Reject non-image content.

### A04 — Insecure Design
- Threat model documented in `docs/threat-model.md`. Write this file.
- Plant photo analysis flow: phone → backend (auth'd) → Claude API → backend → phone. Photos never go directly from phone to Claude.
- Home Assistant tokens never exposed to the phone app. Phone only sends commands to backend; backend calls HA.
- Separate API keys for dev and prod Claude accounts.

### A05 — Security Misconfiguration
- Helmet.js applied globally: CSP, HSTS, X-Frame-Options, etc.
- CORS: whitelist only. In prod, only the mobile app origin is allowed.
- No stack traces in production error responses. Generic error messages to client; full detail to audit log only.
- All unused Express features disabled.
- Docker containers run as non-root user.
- `tsconfig.json`: `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.

### A06 — Vulnerable and Outdated Components
- `package.json`: pin all dependency versions (no `^` or `~` in prod).
- Add `npm audit` step to CI pipeline. Fail CI on high/critical CVEs.
- Add `dependabot.yml` to auto-create PRs for security patches.
- Document Node.js version in `.nvmrc` and Docker base image. Use `node:20-alpine` (smaller attack surface).
- Comment every dependency with its purpose — makes audit easier.

### A07 — Identification and Authentication Failures
- Access tokens: 15 minute expiry.
- Refresh tokens: 7 day expiry, single-use (rotate on use, invalidate old).
- Refresh tokens stored as bcrypt hash in DB with `userId`, `issuedAt`, `expiresAt`, `revoked` fields.
- Failed login attempts: rate limit to 5 per 15 minutes per IP. Lock account after 10 failed attempts. Log all failures.
- Passwords: bcrypt with cost factor 12.
- No password hints. No security questions.
- Session invalidation on logout (add refresh token to revocation list).

### A08 — Software and Data Integrity Failures
- Verify `package-lock.json` integrity in CI (`npm ci`, not `npm install`).
- Claude API responses validated with zod before being acted upon.
- Home Assistant webhook payloads validated with zod + HMAC signature check.
- OTA mobile updates: use Expo's signed update mechanism.

### A09 — Security Logging and Monitoring Failures
- Audit log every: login attempt (success/fail), JWT issue, token refresh, logout, every HA command sent, every Claude API call (prompt hash, not content), every photo upload, every failed auth middleware check.
- Log format: structured JSON with `timestamp`, `userId`, `action`, `ip`, `result`, `metadata`.
- Logs written to rotating daily files. Never log: passwords, tokens, raw API keys, photo contents.
- In dev: logs to console + file. In prod: logs to file only, console disabled.
- Alert on: 5+ failed logins from same IP in 5 minutes, any HA command outside permitted zones.

### A10 — Server-Side Request Forgery (SSRF)
- Home Assistant URL loaded from env config only. Never accept HA URL from client input.
- Claude API calls made only to `api.anthropic.com`. No dynamic URL construction.
- Validate all URLs in config against an allowlist on startup. Throw if unexpected domain.
- No URL-fetching endpoints exposed to clients.

---

## 5. ENVIRONMENT SEPARATION

### Rules (enforced in code)
1. `NODE_ENV` must be explicitly set. App throws on startup if missing.
2. Dev-only features are gated by `features.ts` feature flag that checks `NODE_ENV === 'development'`. These include: verbose error messages, debug endpoints, mock HA responses, mock glasses session, SQL query logging.
3. `.env.dev` and `.env.prod` are separate files. CI validates that no dev secret appears in prod config.
4. Dev Docker containers run on different ports from prod.
5. Dev uses a separate SQLite file / Postgres database. Never share a DB between dev and prod.
6. Dev uses a separate Anthropic API key (set spending limits on it).
7. Git branch strategy: `dev` branch → dev environment, `main` branch → prod. PRs from dev to main require passing CI.

### .env.example (generate this file)
```
# --- App ---
NODE_ENV=                        # 'development' or 'production'
PORT=3000
APP_SECRET=                      # generate with: openssl rand -base64 64

# --- Auth ---
JWT_PRIVATE_KEY_PATH=            # path to RS256 private key PEM
JWT_PUBLIC_KEY_PATH=             # path to RS256 public key PEM
JWT_ACCESS_EXPIRY=900            # seconds (15 min)
JWT_REFRESH_EXPIRY=604800        # seconds (7 days)

# --- Claude API ---
ANTHROPIC_API_KEY=               # NEVER commit this
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# --- Home Assistant ---
HA_BASE_URL=                     # e.g. http://homeassistant.local:8123
HA_TOKEN=                        # HA long-lived access token — NEVER commit
HA_WEBHOOK_SECRET=               # HMAC secret for HA webhook validation

# --- Storage ---
DB_PATH=./data/app.db            # SQLite path (dev) or Postgres URL (prod)
PHOTO_STORAGE_PATH=./data/photos
PHOTO_ENCRYPTION_KEY=            # generate with: openssl rand -base64 32
PHOTO_RETENTION_DAYS=90

# --- Supabase (cloud sync — only required when user enables sync) ---
SUPABASE_URL=                    # your Supabase project URL
SUPABASE_ANON_KEY=               # public anon key
SUPABASE_SERVICE_KEY=            # secret service key — backend only, NEVER put in mobile app

# --- Remote access (add vars here when remote access method is chosen) ---
# See infra/remote-access/OPTIONS.md

# --- Logging ---
LOG_DIR=./logs
LOG_LEVEL=info                   # 'debug' in dev, 'info' or 'warn' in prod

# --- CORS ---
# Comma-separated list of allowed Origin headers for browser callers.
# Native mobile (iOS/Android/Expo) does not send Origin and is unaffected.
CORS_ALLOWED_ORIGINS=

# --- MentraOS (smart glasses) ---
# MENTRA_PACKAGE_NAME and MENTRA_API_KEY come from console.mentra.glass.
# Both must be set together. Leave both blank to skip starting the glasses
# AppServer (useful for backend-only dev before registering an app).
MENTRA_PACKAGE_NAME=
MENTRA_API_KEY=
MENTRA_PORT=7010
```

---

## 6. GLASSES SESSION ARCHITECTURE

```
MentraOS Cloud
      │
      │  WebSocket (MentraOS SDK)
      ▼
base AppServer (TypeScript)
      │
      ├── onTranscription(data) → sanitize → intent parser → command router
      ├── onButtonPress(data)   → trigger photo capture
      ├── onPhoto(data)         → validate → encrypt → store → send to Claude Vision
      └── onLocation(data)      → update user context (zone detection)
      │
      ├── speaks response back via session.layouts / session.audio
      └── emits events to phone app via internal event bus
```

### Garden-specific glasses flows

**Flow 1 — Voice command to HA**
```
User says: "Check the moisture in zone 2"
→ transcription event
→ sanitize (strip prompt injection)
→ parse intent: { action: "sensor_read", zone: "2", sensor: "soil_moisture" }
→ validate zone against user's permitted zones
→ call HA REST API
→ format response
→ speak: "Zone 2 soil moisture is 42 percent. Watering recommended."
```

**Flow 2 — Photo analysis**
```
User presses button on glasses
→ onButtonPress triggers camera capture
→ photo received as base64
→ validate: check magic bytes (JPEG/PNG only)
→ encrypt + store with plantId + timestamp
→ send to Claude Vision with garden expert system prompt
→ Claude returns: { diagnosis, severity, recommendations, annotationPoints }
→ speak summary through glasses: "I see early signs of powdery mildew on the upper leaves..."
→ push annotated photo + full report to phone app via WebSocket
```

**Flow 3 — Proactive alert**
```
HA webhook: soil moisture in zone 3 below threshold
→ validate HMAC signature
→ look up user for that zone
→ if glasses connected: speak alert
→ push notification to phone app
→ audit log: { action: "proactive_alert", zone: "3", trigger: "soil_moisture_low" }
```

---

## 7. CLAUDE AI — GARDEN EXPERT CONFIGURATION

### System prompt (garden/backend/src/ai/gardenExpert.ts)

```typescript
const GARDEN_EXPERT_SYSTEM_PROMPT = `
You are an expert botanist and horticulturalist AI assistant.
You have deep knowledge of plant diseases, pests, nutrition deficiencies, 
watering needs, pruning techniques, and seasonal care.

When analysing a plant photo, always return a structured JSON response with:
{
  "spokenSummary": "2-3 sentence summary suitable for text-to-speech",
  "diagnosis": {
    "overallHealth": "excellent|good|fair|poor|critical",
    "issues": [{ "type": string, "severity": "low|medium|high", "description": string }]
  },
  "recommendations": [{ "action": string, "priority": "immediate|soon|routine", "detail": string }],
  "annotationPoints": [{ "x": number, "y": number, "label": string, "color": string }],
  "trimming": { "needed": boolean, "areas": [{ "description": string }] },
  "wateringNeeds": { "status": "overwatered|optimal|underwatered|unknown", "recommendation": string },
  "sensorContext": "optional note about how current sensor readings relate to what you see"
}

Always speak to the user in a calm, knowledgeable, British-accented style.
Keep spoken summaries under 40 words for comfortable glass speaker delivery.
`.trim();
```

### Context injection
Before each Claude call, inject current sensor readings for the relevant zone:
```typescript
const contextMessage = `
Current sensor readings for ${zone.name}:
- Soil moisture: ${sensors.soilMoisture}%
- Temperature: ${sensors.temperature}°C
- Humidity: ${sensors.humidity}%
- Light level: ${sensors.lightLevel} lux
- pH: ${sensors.pH}
- Last watered: ${sensors.lastWatered}
`;
```

---

## 8. HOME ASSISTANT INTEGRATION

### Client design (garden/backend/src/homeAssistant/client.ts)
- Base URL and token loaded from env only. Never from client input.
- All entity IDs validated against a user-specific whitelist stored in DB.
- Request timeout: 5 seconds. Retry: 2 attempts with exponential backoff.
- Every HA call audit logged with userId, entity, action, result.

### Zone model
```typescript
interface GardenZone {
  id: string;           // UUID
  userId: string;       // owner
  name: string;         // "Zone 1 — Raised Bed"
  sensors: {
    soilMoisture?: string;    // HA entity_id
    temperature?: string;
    humidity?: string;
    lightLevel?: string;
    pH?: string;
    npk?: string;
    rain?: string;
  };
  actuators: {
    waterValve?: string;      // HA entity_id
    growLight?: string;
    fan?: string;
    heater?: string;
  };
}
```

### Permitted commands (whitelist — expand carefully)
```typescript
const PERMITTED_COMMANDS = [
  'turn_on_water',
  'turn_off_water',
  'turn_on_light',
  'turn_off_light',
  'turn_on_fan',
  'turn_off_fan',
  'turn_on_heater',
  'turn_off_heater',
  'read_sensor',
] as const;
```

---

## 9. PHOTO STORAGE & ENCRYPTION

```typescript
// garden/backend/src/storage/photoStore.ts

// On write:
// 1. Validate magic bytes (JPEG: FF D8 FF, PNG: 89 50 4E 47)
// 2. Generate random IV (16 bytes)
// 3. Encrypt with AES-256-GCM using PHOTO_ENCRYPTION_KEY from env
// 4. Store: { iv, authTag, ciphertext } as .enc file
// 5. Write metadata to DB: { photoId, userId, plantId, zoneId, timestamp, filePath, analysisId }

// On read:
// 1. Auth check: userId must match photo.userId
// 2. Decrypt with stored IV + auth tag
// 3. Return decrypted buffer — never write decrypted file to disk

// Retention:
// Cron job runs daily: delete photos older than PHOTO_RETENTION_DAYS
// Log deletions to audit log
```

---

## 10. PHONE APP — ANNOTATED PHOTO DISPLAY

### PlantAnalysis.tsx flow
1. Receive from backend: `{ photoBase64, annotationPoints, diagnosis, recommendations, trimming }`
2. Display photo full-screen
3. Overlay `annotationPoints` as coloured circles with labels (using react-native-skia canvas)
4. Swipe up: full diagnosis report card
5. Swipe left/right: navigate plant history
6. "Send to HA" button: trigger recommended watering/care action (requires confirmation tap)

### AnnotatedImage.tsx component props
```typescript
interface AnnotatedImageProps {
  imageBase64: string;
  annotations: Array<{
    x: number;        // 0-1 normalised coordinate
    y: number;        // 0-1 normalised coordinate
    label: string;
    color: string;    // hex
  }>;
  onAnnotationPress?: (label: string) => void;
}
```

---

## 11. LOCAL-FIRST DATA MODEL (SQLite / drizzle-orm)

```typescript
// Core tables (base)
users         { id, email, passwordHash, createdAt, role }
refreshTokens { id, userId, tokenHash, issuedAt, expiresAt, revoked }
auditLog      { id, userId, action, ip, result, metadata, timestamp }

// Garden tables (garden)
plants        { id, userId, name, species, zoneId, createdAt, notes }
gardenZones   { id, userId, name, sensorConfig, actuatorConfig }
plantPhotos   { id, userId, plantId, zoneId, filePath, timestamp, analysisId }
analyses      { id, photoId, userId, diagnosis, recommendations, spokenSummary, rawResponse, createdAt }
sensorHistory { id, zoneId, userId, sensorType, value, unit, recordedAt }
```

### Cloud sync — Supabase

Supabase is the cloud sync and photo backup provider. It is **opt-in**. Users must explicitly enable it in settings. When disabled, the app is fully functional offline with local SQLite only.

```typescript
// base/mobile/src/sync/supabase.ts
// Initialise only when user has opted in and provided credentials.
// SUPABASE_URL and SUPABASE_ANON_KEY come from env — never hardcoded.
// Row-Level Security (RLS) MUST be enabled on every Supabase table.
// RLS policy: users can only SELECT/INSERT/UPDATE/DELETE their own rows (auth.uid() = user_id).

import { createClient } from '@supabase/supabase-js';

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
  uploadPhoto(photoId: string, encryptedBuffer: Buffer): Promise<string>; // returns storage URL
  deletePhoto(storageUrl: string): Promise<void>;
}
```

**Supabase tables** (mirror local SQLite schema — add `user_id` RLS column to each):
- `plants`, `garden_zones`, `plant_photos` (metadata only — encrypted file in Supabase Storage), `analyses`, `sensor_history`

**Supabase Storage bucket**: `plant-photos`
- Bucket policy: private (no public URLs)
- Files named: `{userId}/{photoId}.enc` (pre-encrypted before upload — Supabase never sees plaintext)
- Access: signed URLs with 1-hour expiry, generated by backend only

**Additional env vars for Supabase:**
```
SUPABASE_URL=                    # your project URL
SUPABASE_ANON_KEY=               # public anon key (safe for mobile)
SUPABASE_SERVICE_KEY=            # secret service key — backend only, NEVER in mobile app
```

---

## 12. DEV-ONLY DEBUG FEATURES

These features MUST be gated by `NODE_ENV === 'development'` check in `features.ts`.
If `NODE_ENV === 'production'`, these routes/features must not exist — throw 404, not 403.

- `GET /dev/glasses/mock-session` — simulate a glasses connection without real hardware
- `GET /dev/ha/mock-sensors` — return fake sensor data without calling HA
- `GET /dev/audit/dump` — return last 100 audit log entries as JSON
- `POST /dev/auth/bypass` — issue a test JWT without password (dev only)
- Verbose SQL logging
- Full Claude API request/response logging (in prod: log only prompt hash + response hash)
- Stack traces in error responses

---

## 13. DOCKER SETUP

### docker-compose.dev.yml
```yaml
services:
  backend:
    build:
      context: ./packages/garden/backend
      target: development
    ports: ["3001:3001"]
    env_file: .env.dev
    volumes:
      - ./packages/garden/backend/src:/app/src   # hot reload
      - ./data/dev:/app/data
    user: "node"                                          # non-root

  nginx:
    image: nginx:alpine
    ports: ["8080:80"]
    volumes:
      - ./infra/nginx/nginx.dev.conf:/etc/nginx/nginx.conf
```

### docker-compose.prod.yml
```yaml
services:
  backend:
    build:
      context: ./packages/garden/backend
      target: production
    # IMPORTANT: backend binds to localhost only. Never expose directly to internet.
    # Remote access is handled by a separate tunnel layer (decided later).
    # Options when ready: Cloudflare Tunnel, Tailscale, WireGuard, or local-only.
    # See infra/remote-access/OPTIONS.md for a comparison.
    ports: ["127.0.0.1:3000:3000"]
    env_file: .env.prod
    volumes:
      - ./data/prod:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    user: "node"

  nginx:
    image: nginx:alpine
    # nginx terminates internal TLS between containers and enforces headers.
    # It does NOT bind to a public port — that is the tunnel layer's job.
    ports: ["127.0.0.1:80:80"]
    volumes:
      - ./infra/nginx/nginx.prod.conf:/etc/nginx/nginx.conf
    restart: unless-stopped
    depends_on:
      - backend
```

### Remote access — deferred decision

The docker-compose.prod.yml is intentionally designed so the backend is **never directly reachable from outside the Pi** without an additional layer. That layer is TBD.

Create `infra/remote-access/OPTIONS.md` with this content:

```markdown
# Remote Access Options

The backend binds to 127.0.0.1 only. Choose one of the following when ready.
All options below avoid opening inbound ports on your home router.

## Option A — Cloudflare Tunnel (recommended for go-to-market)
- Free, handles TLS, DDoS protection, Zero Trust access policies
- Adds cloudflared container to docker-compose.prod.yml
- Env var: TUNNEL_TOKEN (from Cloudflare Zero Trust dashboard)
- Best when: you want the app reachable publicly for other users

## Option B — Tailscale (recommended for personal use)
- Zero-config VPN, Pi and your phone share a private network
- Install tailscale on Pi and phone, no router config needed
- No docker changes required — phone connects to Pi's Tailscale IP
- Best when: single-user, max privacy, no public exposure

## Option C — WireGuard (advanced)
- Self-hosted VPN, most control, more setup
- Best when: you want full ownership and already have a VPS

## Option D — Local network only
- App only works at home on your Wi-Fi
- No setup required — works out of the box
- Best for: development and initial testing

## Decision pending
- Document your choice here when made
- Update docker-compose.prod.yml and .env.example accordingly
```

---

## 14. CI PIPELINE (.github/workflows/ci-dev.yml)

Steps (run on every PR to `main`):
1. `npm ci` (not npm install — verifies lockfile integrity)
2. TypeScript compile check (`tsc --noEmit`)
3. `npm audit --audit-level=high` — fail on high/critical CVEs
4. Unit tests (`jest`)
5. Lint (`eslint` with security plugin: `eslint-plugin-security`)
6. Check that no `.env.prod` secrets appear in committed files
7. Docker build (does not run, just verifies it builds)

---

## 15. DEPENDENCY SECURITY NOTES

Pin all versions in `package.json` (no `^` or `~`). Required packages and their security rationale:

**Backend:**
- `express` — pin to latest 4.x, audit regularly
- `helmet` — HTTP security headers (OWASP A05)
- `express-rate-limit` — rate limiting (OWASP A07)
- `zod` — input validation (OWASP A03)
- `jsonwebtoken` — use RS256, not HS256 (OWASP A07)
- `bcryptjs` — password + token hashing, cost 12 (OWASP A02)
- `winston` — structured audit logging (OWASP A09)
- `cors` — strict origin whitelist (OWASP A05)
- `@mentra/sdk` — glasses integration
- `@anthropic-ai/sdk` — Claude API
- `axios` — HA HTTP client, pin version
- `better-sqlite3` — local DB, parameterised queries only

**Mobile:**
- `expo` — pin SDK version, use `expo upgrade` for updates
- `expo-secure-store` — Android Keystore + iOS Secure Enclave backed token storage
- `expo-sqlite` — local-first DB, works on both platforms
- `drizzle-orm` — type-safe queries, no raw SQL strings
- `@supabase/supabase-js` — cloud sync (opt-in only, never initialised unless user enables)
- `zustand` — state management
- `@tanstack/react-query` — network layer
- `@shopify/react-native-skia` — annotation overlays (both platforms)

**Never add:**
- `eval()`, `Function()`, `vm.runInNewContext()` — code injection risk
- Any package that fetches remote code at runtime
- Any package with known unpatched CVEs in `npm audit`

---

## 16. WHAT TO BUILD FIRST (implementation order)

1. `infra/scripts/generate-secrets.sh` — generate all secrets for .env files
2. `base/backend` — env loader, feature flags, auth (JWT + refresh), helmet, cors, rate limit, audit logger, health check endpoint
3. `base/backend` — MentraOS AppServer base class with empty event handlers
4. `base/mobile` — Expo managed workflow app scaffold (Android + iOS), secure token store (expo-secure-store), SQLite + drizzle setup, auth screens
5. `docs/threat-model.md` — document threats before writing business logic
6. `garden/backend` — HA client (typed, with zone model and entity whitelist)
7. `garden/backend` — Claude Vision plant analysis (with system prompt, sensor context injection, zod response validation)
8. `garden/backend` — photo store (magic byte validation, AES-256-GCM encryption, retention cron)
9. `garden/backend` — garden glasses session (extend base, wire up all 3 flows from section 6)
10. `garden/mobile` — GardenDashboard, PlantAnalysis with AnnotatedImage overlay (Skia), PlantHistory — test on both Android and iOS simulators
11. `base/mobile/src/sync/cloudSync.ts` — Supabase sync (opt-in toggle in settings, RLS validation, encrypted photo upload)
12. `docker-compose.dev.yml` + `docker-compose.prod.yml`
13. `infra/remote-access/OPTIONS.md` — document remote access options, leave choice open
14. `.github/workflows/ci-dev.yml`
15. End-to-end test: speak → transcribe → HA command → response spoken back
16. End-to-end test: button press → photo → Claude Vision → annotation on phone (Android + iOS)

---

## 17. DEFINITION OF DONE

A feature is not done until:
- [ ] TypeScript compiles with zero errors (`strict: true`)
- [ ] OWASP section reference commented in security-relevant code
- [ ] Input validated with zod schema
- [ ] Audit log entry written
- [ ] Dev-only code gated by feature flag
- [ ] `npm audit` passes (no high/critical)
- [ ] Unit test written for auth, validation, and encryption functions
- [ ] No secrets in code or logs (verified by grep in CI)
