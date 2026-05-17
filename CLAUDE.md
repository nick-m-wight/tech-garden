# Smart Glasses Project — Claude Code Specification
## base (template) + garden (garden expert app)

> Read this entire file before writing a single line of code.
> Detailed specs live in `docs/specs/` — links per section below.
>
> **Status (2026-05-17):** §16 steps 1–4 complete. `base-v1.0` tagged. **Next: §16 step 6 — garden HA client.**

---

## 1. PROJECT OVERVIEW

### base
Reusable, secure template for MentraOS smart glasses apps. Handles:
- Glasses ↔ Backend WebSocket session management (MentraOS SDK)
- JWT auth with refresh token rotation
- React Native phone app scaffold (Android + iOS)
- Local-first SQLite + optional Supabase cloud sync (user opt-in)
- OWASP Top 10 mitigations, audit logging, rate limiting

### garden
Built on top of base. Adds:
- Garden Expert AI persona (claude-sonnet-4-20250514 with Vision)
- Plant disease/pest/health recognition via glasses camera
- Annotated photo display on the phone app
- Home Assistant multi-zone sensor reading and actuator control
- Encrypted on-device plant history + optional Supabase cloud sync
- Proactive garden alerts spoken through glasses speakers

---

## 2. MONOREPO STRUCTURE

```
tech-garden/
├── CLAUDE.md
├── .env.example
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── docs/
│   ├── threat-model.md
│   └── specs/
│       ├── security.md        ← OWASP Top 10 full checklist
│       ├── glasses-flows.md   ← garden glasses event flows
│       ├── ai-config.md       ← Claude system prompt + context injection
│       ├── home-assistant.md  ← HA client, zone model, command whitelist
│       ├── photo-storage.md   ← AES-256-GCM, magic byte validation, retention
│       ├── mobile-ui.md       ← PlantAnalysis, AnnotatedImage specs
│       ├── data-model.md      ← SQLite tables, Supabase sync strategy
│       ├── docker.md          ← docker-compose configs
│       ├── ci.md              ← CI pipeline steps
│       └── dependencies.md    ← pinned deps + security rationale
├── .github/workflows/
│   ├── ci-dev.yml
│   └── ci-prod.yml
├── packages/
│   ├── base/
│   │   ├── backend/           ← TypeScript strict, Node.js + Express + WebSocket
│   │   │   └── src/
│   │   │       ├── app.ts
│   │   │       ├── config/
│   │   │       │   ├── env.ts           ← typed env loader, throws on missing vars
│   │   │       │   └── features.ts      ← feature flags (dev-only features blocked in prod)
│   │   │       ├── auth/
│   │   │       │   ├── jwt.ts
│   │   │       │   ├── refresh.ts
│   │   │       │   └── middleware.ts
│   │   │       ├── glasses/
│   │   │       │   ├── session.ts
│   │   │       │   └── events.ts
│   │   │       ├── api/
│   │   │       │   ├── routes.ts
│   │   │       │   └── healthcheck.ts
│   │   │       ├── audit/
│   │   │       │   └── logger.ts
│   │   │       ├── ratelimit/
│   │   │       │   └── limiter.ts
│   │   │       └── security/
│   │   │           ├── helmet.ts
│   │   │           ├── cors.ts
│   │   │           ├── sanitize.ts
│   │   │           └── secrets.ts
│   │   └── mobile/            ← Expo SDK, Android-first
│   │       └── src/
│   │           ├── app/
│   │           ├── components/
│   │           ├── hooks/
│   │           ├── store/db.ts
│   │           ├── sync/cloudSync.ts
│   │           ├── auth/tokenStore.ts
│   │           └── config/env.ts
│   └── garden/                ← GARDEN APP (extends base, never modify base directly)
│       ├── backend/src/
│       │   ├── ai/
│       │   ├── homeAssistant/
│       │   ├── storage/
│       │   └── glasses/gardenSession.ts
│       └── mobile/src/
│           ├── screens/
│           └── components/
└── infra/
    ├── nginx/
    ├── remote-access/OPTIONS.md
    └── scripts/
```

---

## 3. TECHNOLOGY STACK

### Backend
| Concern | Package |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.x (strict) |
| Framework | Express 4.x |
| Glasses SDK | @mentra/sdk |
| AI | @anthropic-ai/sdk (claude-sonnet-4-20250514) |
| Auth | jsonwebtoken (RS256) + bcryptjs |
| Rate limiting | express-rate-limit |
| Input validation | zod |
| Security headers | helmet |
| Audit logging | winston + winston-daily-rotate-file |
| DB | SQLite (better-sqlite3) |
| Encryption | Node.js crypto (AES-256-GCM) |
| HTTP client (HA) | axios |

### Mobile (React Native / Expo)
| Concern | Package |
|---|---|
| Framework | Expo SDK 54 (managed workflow) |
| Navigation | Expo Router v3 |
| Local DB | expo-sqlite + drizzle-orm |
| Secure storage | expo-secure-store |
| Cloud sync | @supabase/supabase-js (opt-in only) |
| Image display | @shopify/react-native-skia |
| State | Zustand |
| Network | TanStack Query |

---

## 4. SECURITY — OWASP TOP 10

OWASP item number MUST be commented in all security-relevant code (e.g. `// OWASP A01`).
→ Full implementation checklist: [docs/specs/security.md](docs/specs/security.md)

**Non-negotiable rules — apply everywhere:**
- All routes require JWT except `/auth/login` and `/health` (A01)
- All DB queries parameterised — no string concatenation (A03)
- All inputs validated with zod before use (A03)
- All secrets from env — never hardcoded, never logged (A02, A09)
- AES-256-GCM for photos at rest, RS256 for JWT (A02)
- Structured audit log on every auth event, HA command, Claude call (A09)
- HA URL and Claude API URL from env only, validated on startup (A10)

---

## 5. ENVIRONMENT SEPARATION

1. `NODE_ENV` must be explicitly set. App throws on startup if missing.
2. Dev-only features gated by `features.ts` (`NODE_ENV === 'development'`): verbose errors, debug endpoints, mock HA, mock glasses session, SQL logging.
3. `.env.dev` and `.env.prod` are separate files. CI validates no dev secret leaks to prod config.
4. Dev Docker on different ports from prod.
5. Dev uses separate SQLite file. Never share DB between dev and prod.
6. Dev uses separate Anthropic API key (set a spending limit).
7. Branch strategy: `dev` → dev environment, `main` → prod.

---

## 6. GLASSES SESSION ARCHITECTURE

```
MentraOS Cloud
      │  WebSocket (MentraOS SDK)
      ▼
base AppServer (TypeScript)
      ├── onTranscription(data) → sanitize → intent parser → command router
      ├── onButtonPress(data)   → trigger photo capture
      ├── onPhoto(data)         → validate → encrypt → store → Claude Vision
      └── onLocation(data)      → update user context (zone detection)
      ├── speaks response via session.layouts / session.audio
      └── emits events to phone via internal event bus
```

→ Garden-specific flows (voice→HA, photo analysis, proactive alert): [docs/specs/glasses-flows.md](docs/specs/glasses-flows.md)

---

## 7. FEATURE SPECS

When implementing any of these, read the linked spec first:

| Feature | Spec file |
|---|---|
| Claude AI system prompt + context injection | [docs/specs/ai-config.md](docs/specs/ai-config.md) |
| Home Assistant client, zone model, commands | [docs/specs/home-assistant.md](docs/specs/home-assistant.md) |
| Photo storage, AES-256-GCM, retention | [docs/specs/photo-storage.md](docs/specs/photo-storage.md) |
| PlantAnalysis screen, AnnotatedImage component | [docs/specs/mobile-ui.md](docs/specs/mobile-ui.md) |
| SQLite tables, Supabase sync strategy | [docs/specs/data-model.md](docs/specs/data-model.md) |
| Docker compose configs | [docs/specs/docker.md](docs/specs/docker.md) |
| CI pipeline steps | [docs/specs/ci.md](docs/specs/ci.md) |
| Pinned dependencies + security rationale | [docs/specs/dependencies.md](docs/specs/dependencies.md) |

---

## 8. DEV-ONLY DEBUG FEATURES

Gated by `NODE_ENV === 'development'` in `features.ts`. In prod: return 404, not 403.

- `GET /dev/glasses/mock-session` — simulate glasses without hardware
- `GET /dev/ha/mock-sensors` — fake sensor data without calling HA
- `GET /dev/audit/dump` — last 100 audit log entries
- `POST /dev/auth/bypass` — issue test JWT without password
- Verbose SQL logging
- Full Claude API request/response logging (prod: prompt hash + response hash only)
- Stack traces in error responses

---

## 9. WHAT TO BUILD FIRST (§16 implementation order)

- [x] 1. `infra/scripts/generate-secrets.sh`
- [x] 2. `base/backend` — env, auth, helmet, cors, rate limit, audit logger, healthcheck
- [x] 3. `base/backend` — MentraOS AppServer base class
- [x] 4. `base/mobile` — Expo scaffold, secure token store, SQLite + drizzle, auth screens
- [x] 5. `docs/threat-model.md`
- [ ] 6. `garden/backend` — HA client (typed, zone model, entity whitelist)
- [ ] 7. `garden/backend` — Claude Vision plant analysis (system prompt, sensor context, zod validation)
- [ ] 8. `garden/backend` — photo store (magic bytes, AES-256-GCM, retention cron)
- [ ] 9. `garden/backend` — garden glasses session (extend base, wire all 3 flows)
- [ ] 10. `garden/mobile` — GardenDashboard, PlantAnalysis + AnnotatedImage (Skia), PlantHistory
- [ ] 11. `base/mobile/src/sync/cloudSync.ts` — Supabase sync (opt-in, RLS, encrypted photo upload)
- [ ] 12. `docker-compose.dev.yml` + `docker-compose.prod.yml`
- [ ] 13. `infra/remote-access/OPTIONS.md`
- [ ] 14. `.github/workflows/ci-dev.yml`
- [ ] 15. E2E test: speak → transcribe → HA command → response spoken back
- [ ] 16. E2E test: button press → photo → Claude Vision → annotation on phone

---

## 10. DEFINITION OF DONE

A feature is not done until:
- [ ] TypeScript compiles with zero errors (`strict: true`)
- [ ] OWASP section reference commented in security-relevant code
- [ ] Input validated with zod schema
- [ ] Audit log entry written
- [ ] Dev-only code gated by feature flag
- [ ] `npm audit` passes (no high/critical)
- [ ] Unit test written for auth, validation, and encryption functions
- [ ] No secrets in code or logs (verified by grep in CI)
