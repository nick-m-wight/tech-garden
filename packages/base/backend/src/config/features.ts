// Feature flags for dev-only features.
//
// All flags listed in CLAUDE.md Section 12 are dev-only. They return `false`
// (and log a single warning per feature) whenever NODE_ENV !== 'development'.
//
// OWASP A05 (Misconfiguration): dev features must not leak into production.
// Routes gated by these flags are also expected to short-circuit with 404 in
// prod (never 403) — see CLAUDE.md hard rules. This module is the source of
// truth for "is this feature on?"; route registration uses it to decide
// whether to even mount the handler.
//
// OWASP A09 (Logging failures): every blocked access is logged once so an
// operator can see if production code is trying to reach dev-only paths.

import { loadEnv } from './env';

export type DevFeature =
  | 'mockGlassesSession'   // GET /dev/glasses/mock-session
  | 'mockHaSensors'        // GET /dev/ha/mock-sensors
  | 'devAuditDump'         // GET /dev/audit/dump
  | 'devAuthBypass'        // POST /dev/auth/bypass
  | 'verboseSqlLogging'    // raw SQL printed to log
  | 'verboseClaudeLogging' // full Claude API request/response in log
  | 'stackTracesInErrors'; // stack traces leak to HTTP error responses

const warned = new Set<DevFeature>();

function logBlockedOnce(name: DevFeature, nodeEnv: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  // Placeholder logger. Replaced by the structured audit logger
  // (CLAUDE.md Section 16 step 2). Until then, console.warn is acceptable
  // and never carries secrets.
  // eslint-disable-next-line no-console
  console.warn(
    `[features] dev-only feature "${name}" is disabled because NODE_ENV=${nodeEnv}`,
  );
}

export function isDevFeatureEnabled(name: DevFeature): boolean {
  const { NODE_ENV } = loadEnv();
  if (NODE_ENV === 'development') return true;
  logBlockedOnce(name, NODE_ENV);
  return false;
}

// Convenience accessors so call sites can write `features.mockHaSensors`
// without importing the union type. Each getter calls isDevFeatureEnabled
// so the per-feature warning fires the first time the flag is read in prod.
export const features = {
  get mockGlassesSession(): boolean { return isDevFeatureEnabled('mockGlassesSession'); },
  get mockHaSensors(): boolean { return isDevFeatureEnabled('mockHaSensors'); },
  get devAuditDump(): boolean { return isDevFeatureEnabled('devAuditDump'); },
  get devAuthBypass(): boolean { return isDevFeatureEnabled('devAuthBypass'); },
  get verboseSqlLogging(): boolean { return isDevFeatureEnabled('verboseSqlLogging'); },
  get verboseClaudeLogging(): boolean { return isDevFeatureEnabled('verboseClaudeLogging'); },
  get stackTracesInErrors(): boolean { return isDevFeatureEnabled('stackTracesInErrors'); },
} as const;

// Test-only — resets the per-feature warning de-duplication.
export function __resetFeatureWarningsForTests(): void {
  warned.clear();
}
