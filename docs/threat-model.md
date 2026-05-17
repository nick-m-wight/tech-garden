# Threat Model — Smart Glasses Garden App

## System Overview

```
[Glasses] ──WebSocket──▶ [MentraOS Cloud] ──WebSocket──▶ [Pi Backend]
                                                               │
[Phone App] ──HTTPS──▶ [nginx] ──────────────────────────────▶│
                                                               │
[Home Assistant] ◀──────────────────────────────── local LAN ─┤
[Claude API] ◀────────────────────────────────────── HTTPS ───┤
[Supabase] ◀──────────────────────────────────────── HTTPS ───┘
```

## Trust Boundaries

| Boundary | Protocol | Authentication |
|---|---|---|
| Phone ↔ Backend | HTTPS (nginx terminates) | JWT (RS256, 15min expiry) |
| Glasses ↔ MentraOS Cloud | WebSocket (MentraOS SDK) | MentraOS API key |
| MentraOS Cloud ↔ Backend | WebSocket (MentraOS SDK) | MentraOS package name + API key |
| Backend ↔ Home Assistant | HTTP (local LAN) | HA long-lived access token |
| Backend ↔ Claude API | HTTPS | Anthropic API key |
| Backend ↔ Supabase | HTTPS | Supabase service key |
| Backend ↔ local disk | — | File system permissions |

## Assets

| Asset | Sensitivity | Protection |
|---|---|---|
| User passwords | Critical | bcrypt cost 12, never stored plain |
| JWT access tokens | High | 15min expiry, RS256, HTTPS only |
| JWT refresh tokens | High | bcrypt hashed in DB, single-use rotation |
| HA long-lived token | Critical | Env only, never sent to phone, never logged |
| Anthropic API key | High | Env only, never logged |
| Plant photos | High | AES-256-GCM at rest, user-scoped access |
| Plant health data | Medium | userId filter on all queries, opt-in cloud sync |
| Sensor history | Low | userId filter, local only unless sync enabled |
| HA entity IDs / zone config | Medium | Per-user whitelist, validated before use |

## Threat Actors

| Actor | Capability | Motivation |
|---|---|---|
| External attacker | Internet access, automated scanning | Credential theft, data exfiltration, HA device control |
| Compromised phone | Access to stored tokens | Escalate from phone compromise to backend/HA |
| Malicious voice input | Craft speech to exploit transcription pipeline | Prompt injection into Claude, unauthorized HA commands |
| Local network attacker | LAN access | Direct HA API access, intercept unencrypted local traffic |
| Compromised MentraOS cloud | Man-in-the-middle on glasses WebSocket | Inject fake transcriptions, intercept photo data |

---

## Threats & Mitigations

### T01 — Credential Brute Force
**Component:** `/auth/login`
**Attack:** Automated credential stuffing or password spray.
**Mitigation:** Rate limit 5 attempts per 15min per IP; account lock after 10 failures; bcrypt cost 12 slows offline cracking; audit log all failures.
**Residual risk:** Low.

### T02 — JWT Token Theft
**Component:** Phone app, HTTPS transit.
**Attack:** Stolen access token used to impersonate user.
**Mitigation:** 15min expiry limits window; HTTPS enforced; tokens stored in expo-secure-store (Android Keystore / iOS Secure Enclave); refresh token rotation invalidates old tokens on next use.
**Residual risk:** Low — short window, device-backed storage.

### T03 — Refresh Token Replay
**Component:** `/auth/refresh`
**Attack:** Intercepted refresh token reused after rotation.
**Mitigation:** Single-use rotation — using a token invalidates it and issues a new one; old token revoked immediately; bcrypt hash stored, not raw token.
**Residual risk:** Low.

### T04 — Prompt Injection via Voice
**Component:** Transcription pipeline → Claude context.
**Attack:** User speaks crafted phrase to manipulate Claude into issuing unauthorized HA commands or leaking data.
**Mitigation:** Transcription sanitized before appending to Claude context (strip injection patterns); Claude response validated with zod before acting; HA commands require matching the permitted command whitelist regardless of Claude output.
**Residual risk:** Medium — prompt injection is an evolving attack surface; zod + whitelist provide hard boundaries.

### T05 — Unauthorized HA Command
**Component:** Voice → intent parser → HA client.
**Attack:** Manipulate the system (via voice, API, or prompt injection) to send arbitrary HA commands.
**Mitigation:** Entity IDs validated against per-user whitelist in DB; only `PERMITTED_COMMANDS` are executable; phone app cannot call HA directly — all commands go through authenticated backend; every HA call audit logged.
**Residual risk:** Low.

### T06 — SSRF via HA URL
**Component:** HA client config.
**Attack:** Supply a malicious HA URL to make the backend issue requests to internal services.
**Mitigation:** `HA_BASE_URL` loaded from env only — never from client input; URL validated against allowlist on startup; no URL-fetching endpoints exposed to clients.
**Residual risk:** Low.

### T07 — Photo Data Exfiltration
**Component:** Photo storage on Pi disk / Supabase.
**Attack:** Read encrypted photo files from disk, or access Supabase storage bucket.
**Mitigation:** AES-256-GCM encryption at rest; decrypted buffer never written to disk; auth check (userId match) on every read; Supabase bucket is private with 1-hour signed URLs generated by backend only.
**Residual risk:** Low — attacker needs both the encrypted file and `PHOTO_ENCRYPTION_KEY`.

### T08 — Insecure Direct Object Reference
**Component:** All API endpoints returning plant/photo/analysis data.
**Attack:** Manipulate IDs in requests to access another user's data.
**Mitigation:** All DB queries include `WHERE userId = :userId`; UUIDs used (not sequential IDs); userId taken from validated JWT, not request body.
**Residual risk:** Low.

### T09 — SQL Injection
**Component:** All DB queries.
**Attack:** Inject SQL via user-controlled input fields.
**Mitigation:** All queries use parameterised statements (drizzle-orm / better-sqlite3); all inputs validated with zod before use; no raw SQL string concatenation.
**Residual risk:** Low.

### T10 — Dependency Compromise (Supply Chain)
**Component:** npm dependencies.
**Attack:** Malicious package or compromised transitive dependency.
**Mitigation:** All versions pinned (no `^` or `~`); `npm ci` in CI verifies lockfile integrity; `npm audit` in CI fails on high/critical CVEs; Dependabot auto-raises security PRs.
**Residual risk:** Medium — transitive dependencies are harder to audit; mitigated by lockfile pinning.

### T11 — Secrets Leaked in Logs
**Component:** Logger / audit log.
**Attack:** Log inspection reveals API keys, tokens, or passwords.
**Mitigation:** Redact middleware strips known secret fields before logging; never log: passwords, raw tokens, API keys, photo content; in prod console logging disabled; log files stored on Pi with filesystem permissions.
**Residual risk:** Low.

### T12 — Backend Exposed Directly to Internet
**Component:** Docker / network config.
**Attack:** Direct port scan reaches backend, bypassing nginx.
**Mitigation:** Backend binds to `127.0.0.1` only; nginx is the only public-facing process; remote access via tunnel layer (Cloudflare/Tailscale) that does not open inbound router ports.
**Residual risk:** Low when tunnel layer is configured correctly.

### T13 — HA Token Exposed to Phone
**Component:** Architecture.
**Attack:** Compromised phone app extracts HA token and directly controls devices.
**Mitigation:** By design, HA token never leaves the backend; phone sends intent commands to backend API; backend calls HA; HA token is never in any mobile response payload.
**Residual risk:** Low.

### T14 — Claude API Response Injection
**Component:** Claude API response processing.
**Attack:** Manipulated Claude response causes backend to execute unintended actions.
**Mitigation:** All Claude API responses validated with zod schema before acting on them; annotationPoints and recommendations are display-only; only `PERMITTED_COMMANDS` can trigger HA actions regardless of response content.
**Residual risk:** Low.

---

## Accepted Risks

| Risk | Reason accepted |
|---|---|
| MentraOS cloud compromise | Outside our control; glasses session carries no secrets beyond session ID |
| Physical Pi theft | Out of scope; attacker with physical access can read env files — mitigate with full-disk encryption if needed |
| Supabase service outage | App is fully functional offline; sync is opt-in |

---

## Review Schedule
Re-review this model when:
- A new data flow is added (new API endpoint, new glasses event type)
- A new external service is integrated
- The remote access method is decided (update T12)
- Any `PERMITTED_COMMANDS` are expanded
