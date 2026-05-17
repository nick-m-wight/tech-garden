// HTTP security headers.
//
// OWASP A05 — helmet ships a sane default header set. We tighten CSP for an
// API-only server (nothing renders HTML here) and only enable HSTS in prod
// (HSTS over plain HTTP in dev would brick localhost in the browser).

import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { loadEnv } from '../config/env';

export function helmetMiddleware(): RequestHandler {
  const env = loadEnv();
  const isProd = env.NODE_ENV === 'production';

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProd
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    xPoweredBy: false,
  });
}
