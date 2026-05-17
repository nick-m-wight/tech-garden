import { z } from 'zod';

// EXPO_PUBLIC_* vars are baked in at build time by the Metro bundler (SDK 49+).
// Declare them in a .env.local file at packages/base/mobile/.
const envSchema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.string().url({ message: 'EXPO_PUBLIC_API_BASE_URL must be a valid URL' }),
  EXPO_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  EXPO_PUBLIC_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse({
  EXPO_PUBLIC_API_BASE_URL: process.env['EXPO_PUBLIC_API_BASE_URL'],
  EXPO_PUBLIC_SUPABASE_URL: process.env['EXPO_PUBLIC_SUPABASE_URL'],
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'],
  EXPO_PUBLIC_LOG_LEVEL: process.env['EXPO_PUBLIC_LOG_LEVEL'],
});

if (!parsed.success) {
  throw new Error(`Mobile env config invalid:\n${parsed.error.message}`);
}

export const env = {
  apiBaseUrl: parsed.data.EXPO_PUBLIC_API_BASE_URL,
  supabaseUrl: parsed.data.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: parsed.data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  logLevel: parsed.data.EXPO_PUBLIC_LOG_LEVEL,
  cloudSyncEnabled:
    parsed.data.EXPO_PUBLIC_SUPABASE_URL !== undefined &&
    parsed.data.EXPO_PUBLIC_SUPABASE_ANON_KEY !== undefined,
} as const;
