// Home Assistant HTTP client.
//
// OWASP A10 — HA_BASE_URL loaded from env only; validateHaUrlOnStartup() confirms
//             it resolves to a private-network host, blocking SSRF to the public internet.
// OWASP A08 — validateWebhookHmac() enforces HMAC-SHA256 on every webhook payload.
// OWASP A03 — isValidEntityId() enforces HA entity_id format before any API call.
// OWASP A09 — callers (sensors.ts, actuators.ts) audit-log every HA interaction.

import axios, { type AxiosInstance, AxiosError } from 'axios';
import crypto from 'node:crypto';
import { z } from 'zod';
import { loadEnv } from '../../../../base/backend/src/config/env';
import { getLogger } from '../../../../base/backend/src/audit/logger';

// ---- HA REST API response types ----

export const HaStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
});
export type HaState = z.infer<typeof HaStateSchema>;

// ---- Entity ID validation (OWASP A03) ----

const ENTITY_ID_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function isValidEntityId(entityId: string): boolean {
  return ENTITY_ID_RE.test(entityId);
}

// ---- Startup URL validation (OWASP A10) ----

// Private-network hostname patterns — HA must never be on a public IP.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^.*\.local$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
];

export function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(hostname));
}

export function validateHaUrlOnStartup(): void {
  const env = loadEnv();
  if (!env.HA_BASE_URL) return; // optional until §16 step 9
  const { hostname } = new URL(env.HA_BASE_URL); // env.ts already validates URL format
  if (!isPrivateHostname(hostname)) {
    throw new Error(
      `HA_BASE_URL hostname '${hostname}' must resolve to a private network address. ` +
        'Home Assistant should not be directly reachable from the public internet.',
    );
  }
  getLogger().info({ msg: 'ha.url_validated', hostname });
}

// ---- HMAC webhook validation (OWASP A08) ----

// HA sends: X-HA-Signature-256: sha256=<hex>
// Constant-time comparison prevents timing-attack signature guessing.
export function validateWebhookHmac(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader
    : `sha256=${signatureHeader}`;
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// ---- HAClient ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof AxiosError) {
    // Retry on network errors (no response) or HA server errors (5xx).
    // Do NOT retry on 4xx — those are configuration/auth errors.
    return !err.response || err.response.status >= 500;
  }
  return false;
}

export class HAClient {
  private readonly http: AxiosInstance;

  constructor() {
    const env = loadEnv();
    if (!env.HA_BASE_URL || !env.HA_TOKEN) {
      throw new Error('HA_BASE_URL and HA_TOKEN must both be set to use HAClient');
    }
    // HA_TOKEN comes from env only — never from client input (OWASP A10)
    this.http = axios.create({
      baseURL: env.HA_BASE_URL,
      timeout: 5000,
      headers: {
        Authorization: `Bearer ${env.HA_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // 1 initial attempt + 2 retries (100 ms, 200 ms backoff) per spec §8.
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delays: [number, number, number] = [0, 100, 200];
    let lastError: unknown = new Error('HAClient.withRetry: no attempts made');
    for (const delay of delays) {
      if (delay > 0) await sleep(delay);
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) break;
      }
    }
    throw lastError;
  }

  // OWASP A08 — parse response through zod schema before returning
  async getState(entityId: string): Promise<HaState> {
    return this.withRetry(async () => {
      const res = await this.http.get<unknown>(`/api/states/${entityId}`);
      return HaStateSchema.parse(res.data);
    });
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.withRetry(async () => {
      await this.http.post(`/api/services/${domain}/${service}`, data);
    });
  }
}
