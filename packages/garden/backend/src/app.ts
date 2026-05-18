// Garden app bootstrap — extends the base Express stack with garden-specific routes.
//
// Mounting order matters:
//   1. helmet + cors + rate limiter (security baseline)
//   2. /garden/* alert webhook (needs raw body for HMAC, before express.json)
//   3. express.json (parses remaining request bodies)
//   4. base auth + health routes
//   5. 404 + error handler
//
// OWASP A05 — middleware order documented above; dev-only features gated by features.ts.

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { loadEnv } from '../../../base/backend/src/config/env';
import { features } from '../../../base/backend/src/config/features';
import { getLogger } from '../../../base/backend/src/audit/logger';
import { helmetMiddleware } from '../../../base/backend/src/security/helmet';
import { corsMiddleware } from '../../../base/backend/src/security/cors';
import { defaultLimiter } from '../../../base/backend/src/ratelimit/limiter';
import { buildRoutes } from '../../../base/backend/src/api/routes';
import { getGardenDb } from './db/connection';
import { createAlertRouter } from './glasses/alertWebhook';
import { createGardenRouter } from './api/gardenRoutes';
import {
  maybeStartGardenAppServer,
  stopGardenAppServer,
} from './glasses/gardenSession';

export function buildGardenApp(): express.Express {
  loadEnv();
  const db = getGardenDb(); // runs garden DDL migrations before any route uses the DB

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(helmetMiddleware());
  app.use(corsMiddleware());
  app.use(defaultLimiter);

  // Alert webhook uses inline express.raw() — must come before express.json().
  app.use('/garden', createAlertRouter(db));

  app.use(express.json({ limit: '256kb' }));
  app.use(buildRoutes());
  app.use('/api/garden', createGardenRouter(db));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    getLogger().error({ msg: 'unhandled error', err: err.message, path: req.path });
    if (features.stackTracesInErrors) {
      res.status(500).json({ error: err.message, stack: err.stack });
    } else {
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return app;
}

if (require.main === module) {
  const env = loadEnv();
  const logger = getLogger();
  const db = getGardenDb();
  const app = buildGardenApp();

  const server = app.listen(env.PORT, '127.0.0.1', () => {
    logger.info({ msg: 'garden.server.listening', port: env.PORT, bind: '127.0.0.1' });
  });

  maybeStartGardenAppServer(db).catch((err: Error) => {
    logger.error({ msg: 'garden.appserver.start_failed', err: err.message });
  });

  const shutdown = (signal: string): void => {
    logger.info({ msg: 'garden.server.shutdown', signal });
    server.close(() => {
      stopGardenAppServer()
        .catch((err: Error) => {
          logger.error({ msg: 'garden.appserver.stop_failed', err: err.message });
        })
        .finally(() => {
          process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
