# Dependency Security Notes

Pin all versions in `package.json` (no `^` or `~`).

## Backend
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

## Mobile
- `expo` — pin SDK version, use `expo upgrade` for updates
- `expo-secure-store` — Android Keystore + iOS Secure Enclave backed token storage
- `expo-sqlite` — local-first DB, works on both platforms
- `drizzle-orm` — type-safe queries, no raw SQL strings
- `@supabase/supabase-js` — cloud sync (opt-in only, never initialised unless user enables)
- `zustand` — state management
- `@tanstack/react-query` — network layer
- `@shopify/react-native-skia` — annotation overlays (both platforms)

## Never add
- `eval()`, `Function()`, `vm.runInNewContext()` — code injection risk
- Any package that fetches remote code at runtime
- Any package with known unpatched CVEs in `npm audit`
