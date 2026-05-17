// Express auth middleware.
//
// OWASP A01 — every protected route hangs off requireAuth(). The only routes
// permitted without auth are /auth/login and /health (CLAUDE.md hard rules).
// requireRole() layered on top enforces RBAC.

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt';
import { auditLog } from '../audit/logger';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { userId: string; role: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    auditLog({ action: 'auth.missing_bearer', ip: req.ip, result: 'denied' });
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    auditLog({ action: 'auth.empty_bearer', ip: req.ip, result: 'denied' });
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const claims = verifyAccessToken(token);
    req.user = { userId: claims.sub, role: claims.role };
    next();
  } catch (err) {
    auditLog({
      action: 'auth.invalid_token',
      ip: req.ip,
      result: 'denied',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
    res.status(401).json({ error: 'unauthorized' });
  }
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // 'admin' is a superset.
    if (req.user.role !== role && req.user.role !== 'admin') {
      auditLog({
        action: 'auth.role_denied',
        userId: req.user.userId,
        ip: req.ip,
        result: 'denied',
        metadata: { required: role, actual: req.user.role },
      });
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
