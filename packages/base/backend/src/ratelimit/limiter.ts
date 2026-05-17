// Per-route rate limits.
//
// OWASP A07 — slows credential stuffing / brute force.
// CLAUDE.md §4 A07: login is 5 / 15 min / IP; lockout at 10 failed attempts.
// (The 10-fail lockout is enforced in api/routes.ts on the user record; the
// 5-fail rate-limit is enforced here on the IP.)

import rateLimit, { type Options } from 'express-rate-limit';
import type { RequestHandler } from 'express';

const WINDOW_MS = 15 * 60 * 1000;

function make(max: number, opts: Partial<Options> = {}): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    max,
    ...opts,
  });
}

// /auth/login — 5 *failed* logins per 15 min per IP. Successful login does
// not count toward the limit so a legitimate user fat-fingering once and
// then succeeding isn't penalised.
export const loginLimiter: RequestHandler = make(5, { skipSuccessfulRequests: true });

// /auth/refresh — 10 / 15 min / IP. Refresh is mostly idle.
export const refreshLimiter: RequestHandler = make(10);

// Default for every other route.
export const defaultLimiter: RequestHandler = make(100);
