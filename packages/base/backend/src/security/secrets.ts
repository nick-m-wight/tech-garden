// Single source of truth for secret-bearing field names + a redactor.
//
// OWASP A09 — every log line passes through redactSecrets() before write, so
// even if a caller accidentally hands a password / token / api key to the
// logger it never reaches disk.

const SECRET_FIELDS: readonly string[] = [
  'password', 'password_hash', 'passwordhash',
  'token', 'tokens',
  'access_token', 'accesstoken',
  'refresh_token', 'refreshtoken',
  'authorization', 'cookie', 'set-cookie',
  'api_key', 'apikey',
  'anthropic_api_key',
  'ha_token',
  'app_secret',
  'photo_encryption_key',
  'supabase_service_key', 'supabase_anon_key',
  'webhook_secret', 'ha_webhook_secret',
  'jwt', 'jwt_private_key', 'private_key', 'privatekey',
  'mentra_api_key',
];

const SECRET_SET: ReadonlySet<string> = new Set(SECRET_FIELDS);

const PLACEHOLDER = '[REDACTED]';
const MAX_DEPTH = 8;

export function isSecretKey(key: string): boolean {
  return SECRET_SET.has(key.toLowerCase());
}

export function redactSecrets(value: unknown): unknown {
  return walk(value, MAX_DEPTH, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth < 0) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => walk(v, depth - 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = PLACEHOLDER;
    } else {
      out[k] = walk(v, depth - 1, seen);
    }
  }
  return out;
}
