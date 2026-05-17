# Claude Code — Opening Prompt
# Paste this as your first message when starting a new Claude Code session.
# Claude Code will also read CLAUDE.md automatically from the project root.

---

You are building a secure, production-grade smart glasses home and garden control system.

Read `CLAUDE.md` in full before writing any code. That file is the source of truth.

## Platform targets
- **Backend**: TypeScript strict mode, Node.js, runs on Raspberry Pi. Backend binds to localhost only — remote access method TBD (see `infra/remote-access/OPTIONS.md`)
- **Mobile**: React Native (Expo managed workflow) — **Android AND iOS from day one**
- **Cloud sync**: Supabase — opt-in only, user controls it, never initialised unless explicitly enabled
- **Glasses**: Mentra Live via MentraOS SDK

## Your first task

Build in the exact order specified in CLAUDE.md Section 16. Do not skip ahead.

Start with:

1. Create the full monorepo folder structure from Section 2 (directories and placeholder files only — no logic yet).
2. Write `infra/scripts/generate-secrets.sh` — a bash script that generates all required secrets (JWT RS256 keypair, app secret, photo encryption key, webhook secret) and writes them to `.env.dev` and `.env.prod` from `.env.example`.
3. Write `.env.example` exactly as specified in Section 5.
4. Write `base/backend/src/config/env.ts` — a typed env loader using zod that throws a descriptive error on startup if any required variable is missing or malformed.
5. Write `base/backend/src/config/features.ts` — a feature flag module. All dev-only features listed in Section 12 must return `false` (and log a warning) if `NODE_ENV !== 'development'`.

## Hard rules (never break these)

- TypeScript strict mode everywhere. `noImplicitAny: true`. No `any` types.
- No secrets in code. All secrets come from env. Never log secrets.
- Every DB query uses parameterised statements. No string concatenation in SQL.
- Every API route (except `/auth/login` and `/health`) requires valid JWT middleware.
- Dev-only routes: if `NODE_ENV === 'production'`, return 404 (not 403). They must not exist.
- All user inputs validated with zod before use.
- Every significant action writes to the audit log.
- `npm audit` must pass before any feature is considered complete.
- Pin all package versions (no `^` or `~` in package.json).
- Docker containers run as non-root `node` user.

## Security references

When writing security-sensitive code, comment the relevant OWASP item:
```typescript
// OWASP A03 — Injection: parameterised query, never string concat
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
```

## When you finish each section

Tell me what you built, what security properties it provides, and what comes next.
Ask me before making any architectural decision not covered in CLAUDE.md.

---

Begin.
