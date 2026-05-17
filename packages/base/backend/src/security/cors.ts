// CORS allowlist.
//
// OWASP A05 — strict whitelist, never `*`.
//
// Native mobile clients (iOS / Android / Expo built apps) make HTTP requests
// without an Origin header, so CORS does not apply to them — they are allowed
// through this middleware regardless of the allowlist. Browser callers must
// match an entry in CORS_ALLOWED_ORIGINS exactly.

import cors from 'cors';
import type { RequestHandler } from 'express';
import { loadEnv } from '../config/env';

export function corsMiddleware(): RequestHandler {
  const env = loadEnv();
  const allowed = new Set(
    env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  );

  return cors({
    origin(origin, cb) {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (allowed.has(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('cors: origin not allowed'));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
}
