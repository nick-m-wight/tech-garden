// Liveness probe. No auth required (CLAUDE.md hard rules).
// Intentionally trivial: never expose internal version / git sha / dep info,
// since /health may be the only externally reachable endpoint via the future
// tunnel layer.

import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
