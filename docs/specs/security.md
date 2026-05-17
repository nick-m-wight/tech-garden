# OWASP Top 10 — Full Implementation Checklist

Comments in security-relevant code MUST reference the OWASP item number (e.g. `// OWASP A01`).

## A01 — Broken Access Control
- Every API route requires valid JWT. No exceptions except `/auth/login` and `/health`.
- JWT payload includes `userId` and `role`. Role checked on every protected route.
- Users can only access their own plant data. Add `WHERE userId = :userId` to every DB query.
- Home Assistant commands validated against a user's permitted zones only.
- No direct object references in URLs (use opaque UUIDs, never sequential IDs).

## A02 — Cryptographic Failures
- All plant photos encrypted at rest with AES-256-GCM before writing to disk.
- Encryption key stored in `.env`, never hardcoded, never logged.
- JWT signed with RS256 (asymmetric) — private key on server, public key distributed.
- Refresh tokens are hashed (bcrypt) before storing in DB. Raw token never stored.
- HTTPS only in prod. Enforce via nginx + HSTS header.
- Secrets never appear in logs (redact middleware on logger).

## A03 — Injection
- All DB queries use parameterised statements (never string concatenation).
- All user inputs validated and typed with `zod` schemas before use.
- Home Assistant entity IDs validated against a whitelist before being sent to HA API.
- AI prompts sanitized — user speech transcriptions stripped of prompt injection patterns before appended to Claude context.
- Image file uploads validated: check magic bytes, not just extension. Reject non-image content.

## A04 — Insecure Design
- Threat model documented in `docs/threat-model.md`.
- Plant photo analysis flow: phone → backend (auth'd) → Claude API → backend → phone. Photos never go directly from phone to Claude.
- Home Assistant tokens never exposed to the phone app. Phone only sends commands to backend; backend calls HA.
- Separate API keys for dev and prod Claude accounts.

## A05 — Security Misconfiguration
- Helmet.js applied globally: CSP, HSTS, X-Frame-Options, etc.
- CORS: whitelist only. In prod, only the mobile app origin is allowed.
- No stack traces in production error responses. Generic error messages to client; full detail to audit log only.
- All unused Express features disabled.
- Docker containers run as non-root user.
- `tsconfig.json`: `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.

## A06 — Vulnerable and Outdated Components
- `package.json`: pin all dependency versions (no `^` or `~` in prod).
- Add `npm audit` step to CI pipeline. Fail CI on high/critical CVEs.
- Add `dependabot.yml` to auto-create PRs for security patches.
- Document Node.js version in `.nvmrc` and Docker base image. Use `node:20-alpine`.
- Comment every dependency with its purpose — makes audit easier.

## A07 — Identification and Authentication Failures
- Access tokens: 15 minute expiry.
- Refresh tokens: 7 day expiry, single-use (rotate on use, invalidate old).
- Refresh tokens stored as bcrypt hash in DB with `userId`, `issuedAt`, `expiresAt`, `revoked` fields.
- Failed login attempts: rate limit to 5 per 15 minutes per IP. Lock account after 10 failed attempts. Log all failures.
- Passwords: bcrypt with cost factor 12.
- No password hints. No security questions.
- Session invalidation on logout (add refresh token to revocation list).

## A08 — Software and Data Integrity Failures
- Verify `package-lock.json` integrity in CI (`npm ci`, not `npm install`).
- Claude API responses validated with zod before being acted upon.
- Home Assistant webhook payloads validated with zod + HMAC signature check.
- OTA mobile updates: use Expo's signed update mechanism.

## A09 — Security Logging and Monitoring Failures
- Audit log every: login attempt (success/fail), JWT issue, token refresh, logout, every HA command sent, every Claude API call (prompt hash, not content), every photo upload, every failed auth middleware check.
- Log format: structured JSON with `timestamp`, `userId`, `action`, `ip`, `result`, `metadata`.
- Logs written to rotating daily files. Never log: passwords, tokens, raw API keys, photo contents.
- In dev: logs to console + file. In prod: logs to file only, console disabled.
- Alert on: 5+ failed logins from same IP in 5 minutes, any HA command outside permitted zones.

## A10 — Server-Side Request Forgery (SSRF)
- Home Assistant URL loaded from env config only. Never accept HA URL from client input.
- Claude API calls made only to `api.anthropic.com`. No dynamic URL construction.
- Validate all URLs in config against an allowlist on startup. Throw if unexpected domain.
- No URL-fetching endpoints exposed to clients.
