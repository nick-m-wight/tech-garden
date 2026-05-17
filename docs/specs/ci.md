# CI Pipeline (.github/workflows/ci-dev.yml)

Steps run on every PR to `main`:

1. `npm ci` — verifies lockfile integrity (OWASP A08)
2. `tsc --noEmit` — TypeScript compile check
3. `npm audit --audit-level=high` — fail on high/critical CVEs (OWASP A06)
4. `jest` — unit tests
5. `eslint` with `eslint-plugin-security` — lint + security rules
6. Check that no `.env.prod` secrets appear in committed files
7. Docker build — verify it builds (does not run)
