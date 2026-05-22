// Express composition.
//
// OWASP A05 — composition order matters: helmet (headers) before json
// (parser) before defaultLimiter (rate) before routes. The error handler is
// last; it never leaks stack traces unless features.stackTracesInErrors is
// on, which only happens when NODE_ENV=development.
//
// CLAUDE.md §13 — the http listener binds to 127.0.0.1 only. Public reach is
// the responsibility of the deferred tunnel layer (Cloudflare/Tailscale/etc).

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { loadEnv } from './config/env';
import { features } from './config/features';
import { getLogger } from './audit/logger';
import { getDb, closeDb } from './db/connection';
import { helmetMiddleware } from './security/helmet';
import { corsMiddleware } from './security/cors';
import { defaultLimiter } from './ratelimit/limiter';
import { buildRoutes } from './api/routes';
import { maybeStartGlassesAppServer, stopGlassesAppServer } from './glasses/session';

export function buildApp(): express.Express {
  loadEnv();
  getDb();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(helmetMiddleware());
  app.use(corsMiddleware());
  app.use(express.json({ limit: '10mb' }));
  app.use(defaultLimiter);

  app.use(buildRoutes());

  app.use((_req, res) => {
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
  const app = buildApp();

  const server = app.listen(env.PORT, '127.0.0.1', () => {
    logger.info({ msg: 'server.listening', port: env.PORT, bind: '127.0.0.1' });
  });

  // Glasses AppServer (no-op if env not configured).
  maybeStartGlassesAppServer().catch((err: Error) => {
    logger.error({ msg: 'glasses.appserver.start_failed', err: err.message });
  });

  const shutdown = (signal: string): void => {
    logger.info({ msg: 'server.shutdown', signal });
    server.close(() => {
      stopGlassesAppServer()
        .catch((err: Error) => {
          logger.error({ msg: 'glasses.appserver.stop_failed', err: err.message });
        })
        .finally(() => {
          closeDb();
          process.exit(0);
        });
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
