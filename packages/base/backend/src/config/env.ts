// Typed environment loader.
//
// Validates process.env against a zod schema. Throws a descriptive error if
// any required variable is missing or malformed.
//
// OWASP references:
//   A02 (Crypto failures)  — JWT key paths verified to exist; key/secret lengths checked.
//   A05 (Misconfiguration) — startup fails fast on any bad config.
//   A09 (Logging failures) — schema enforces structured LOG_LEVEL values.
//   A10 (SSRF)             — HA_BASE_URL is validated as a URL (allowlist is enforced
//                            in the HA client; this is the first gate).
//
// Loading the .env file itself is the caller's job — use Docker `env_file:` in
// containers, or `node --env-file=.env.dev` (Node >= 20.6) for direct runs.
// This module never reads disk for env values; it only reads process.env.

import fs from 'node:fs';
import { z } from 'zod';

const optionalNonEmpty = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const envSchema = z
  .object({
    // ---- App ----
    NODE_ENV: z.enum(['development', 'production', 'test'], {
      errorMap: () => ({ message: "NODE_ENV must be 'development', 'production', or 'test'" }),
    }),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    APP_SECRET: z
      .string()
      .min(64, 'APP_SECRET must be at least 64 characters. Run infra/scripts/generate-secrets.sh'),

    // ---- Auth (OWASP A02, A07) ----
    JWT_PRIVATE_KEY_PATH: z.string().min(1, 'JWT_PRIVATE_KEY_PATH is required'),
    JWT_PUBLIC_KEY_PATH: z.string().min(1, 'JWT_PUBLIC_KEY_PATH is required'),
    JWT_ACCESS_EXPIRY: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_EXPIRY: z.coerce.number().int().positive().default(604800),

    // ---- Claude API ----
    ANTHROPIC_API_KEY: z
      .string()
      .min(1, 'ANTHROPIC_API_KEY is required')
      .regex(/^sk-ant-/, "ANTHROPIC_API_KEY must start with 'sk-ant-'"),
    ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-4-20250514'),

    // ---- Home Assistant (OWASP A10) ----
    HA_BASE_URL: z.string().url('HA_BASE_URL must be a valid URL'),
    HA_TOKEN: z.string().min(1, 'HA_TOKEN is required'),
    HA_WEBHOOK_SECRET: z
      .string()
      .min(32, 'HA_WEBHOOK_SECRET must be at least 32 characters (HMAC)'),

    // ---- Storage (OWASP A02) ----
    DB_PATH: z.string().min(1, 'DB_PATH is required'),
    PHOTO_STORAGE_PATH: z.string().min(1).default('./data/photos'),
    PHOTO_ENCRYPTION_KEY: z
      .string()
      .min(44, 'PHOTO_ENCRYPTION_KEY must be at least 44 characters (base64 of 32 bytes)'),
    PHOTO_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    // ---- Supabase (opt-in cloud sync) ----
    SUPABASE_URL: optionalNonEmpty.pipe(z.string().url().optional()),
    SUPABASE_ANON_KEY: optionalNonEmpty,
    SUPABASE_SERVICE_KEY: optionalNonEmpty,

    // ---- Logging (OWASP A09) ----
    LOG_DIR: z.string().min(1).default('./logs'),
    LOG_LEVEL: z
      .enum(['debug', 'info', 'warn', 'error'])
      .default('info'),

    // ---- CORS (OWASP A05) ----
    // Comma-separated list of allowed Origin headers.
    // Native mobile clients don't send Origin and aren't gated by this.
    // In production an empty list means "only native clients can hit the API".
    CORS_ALLOWED_ORIGINS: z.string().optional().default(''),

    // ---- MentraOS smart glasses ----
    // Obtain MENTRA_PACKAGE_NAME and MENTRA_API_KEY from console.mentra.glass.
    // Both must be set together. If either is blank the glasses AppServer is
    // not started — backend-only dev still works.
    MENTRA_PACKAGE_NAME: optionalNonEmpty,
    MENTRA_API_KEY: optionalNonEmpty,
    MENTRA_PORT: z.coerce.number().int().positive().max(65535).default(7010),
  })
  .superRefine((v, ctx) => {
    // Supabase is all-or-nothing: enabling sync requires all three keys.
    const set = [v.SUPABASE_URL, v.SUPABASE_ANON_KEY, v.SUPABASE_SERVICE_KEY].filter(
      (x) => x !== undefined,
    ).length;
    if (set !== 0 && set !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Supabase config is all-or-nothing. Set all of SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, or leave all blank.',
        path: ['SUPABASE_URL'],
      });
    }

    // OWASP A05: production must not run with dev-grade log verbosity.
    if (v.NODE_ENV === 'production' && v.LOG_LEVEL === 'debug') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LOG_LEVEL=debug is not permitted when NODE_ENV=production',
        path: ['LOG_LEVEL'],
      });
    }

    // Glasses config is pair-or-neither.
    const mentraSet =
      (v.MENTRA_PACKAGE_NAME ? 1 : 0) + (v.MENTRA_API_KEY ? 1 : 0);
    if (mentraSet === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'MENTRA_PACKAGE_NAME and MENTRA_API_KEY must both be set, or both blank.',
        path: ['MENTRA_PACKAGE_NAME'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed. Fix the following in your .env file (template: .env.example):\n${issues}`,
    );
  }

  // OWASP A02: refuse to start if the JWT keypair on disk is missing.
  // The values themselves stay out of memory until auth/jwt.ts reads them.
  const missingFiles: string[] = [];
  for (const keyPath of [result.data.JWT_PRIVATE_KEY_PATH, result.data.JWT_PUBLIC_KEY_PATH]) {
    if (!fs.existsSync(keyPath)) {
      missingFiles.push(keyPath);
    }
  }
  if (missingFiles.length > 0) {
    throw new Error(
      `JWT key file(s) not found:\n${missingFiles.map((p) => `  - ${p}`).join('\n')}\n` +
        'Run infra/scripts/generate-secrets.sh to create the keypair.',
    );
  }

  cached = result.data;
  return cached;
}

// Test-only — clears the cached env so subsequent loadEnv() calls re-validate.
// Not exported via index; tests import directly.
export function __resetEnvCacheForTests(): void {
  cached = undefined;
}
