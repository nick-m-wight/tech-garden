// Base glasses AppServer.
//
// Subclass of @mentra/sdk's AppServer. The SDK builds its own Express
// instance listening on MENTRA_PORT (default 7010) and accepts webhook
// callbacks from MentraOS Cloud. Per CLAUDE.md §6 each user-glasses pair
// becomes an AppSession passed into onSession().
//
// This base class registers the four no-op event handlers from events.ts.
// Garden / future forks override onSession() to wire real flow logic
// (intent routing, photo encryption + Claude analysis, zone alerts).
//
// CLAUDE.md §13 — the SDK's listener also binds to localhost by default; the
// deferred tunnel layer publishes the MentraOS port separately from the
// backend port.

import { AppServer, type AppSession } from '@mentra/sdk';
import { loadEnv } from '../config/env';
import { auditLog, getLogger } from '../audit/logger';
import {
  onTranscriptionEvent,
  onButtonPressEvent,
  onPhotoEvent,
  onLocationEvent,
  type GlassesEventContext,
} from './events';

export interface GlassesAppServerOptions {
  packageName: string;
  apiKey: string;
  port: number;
}

export class GlassesAppServer extends AppServer {
  constructor(opts: GlassesAppServerOptions) {
    super({
      packageName: opts.packageName,
      apiKey: opts.apiKey,
      port: opts.port,
      healthCheck: true,
    });
  }

  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const ctx: GlassesEventContext = { session, sessionId, userId };

    auditLog({
      action: 'glasses.session.start',
      userId,
      result: 'success',
      metadata: { sessionId },
    });

    const cleanups: Array<() => void> = [];
    cleanups.push(session.events.onTranscription((d) => onTranscriptionEvent(ctx, d)));
    cleanups.push(session.events.onButtonPress((d) => onButtonPressEvent(ctx, d)));
    cleanups.push(session.events.onPhotoTaken((d) => onPhotoEvent(ctx, d)));
    cleanups.push(session.events.onLocation((d) => onLocationEvent(ctx, d)));

    session.events.onDisconnected(() => {
      auditLog({
        action: 'glasses.session.end',
        userId,
        result: 'success',
        metadata: { sessionId },
      });
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          // Tolerant — unregistering on a disconnected session shouldn't
          // block other cleanups.
        }
      }
    });
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    auditLog({
      action: 'glasses.session.stop',
      userId,
      result: 'denied',
      metadata: { sessionId, reason },
    });
  }
}

// Module-level singleton so the lifecycle hooks can stop it on shutdown.
let active: GlassesAppServer | undefined;

/**
 * Start the glasses AppServer only when configured.
 *
 * If MENTRA_PACKAGE_NAME / MENTRA_API_KEY are blank, the backend still runs
 * — useful before registering an app at console.mentra.glass.
 */
export async function maybeStartGlassesAppServer(): Promise<GlassesAppServer | undefined> {
  const env = loadEnv();
  if (!env.MENTRA_PACKAGE_NAME || !env.MENTRA_API_KEY) {
    getLogger().info({
      msg: 'glasses.appserver.skipped',
      reason: 'MENTRA_PACKAGE_NAME/MENTRA_API_KEY blank — set both to enable',
    });
    return undefined;
  }
  active = new GlassesAppServer({
    packageName: env.MENTRA_PACKAGE_NAME,
    apiKey: env.MENTRA_API_KEY,
    port: env.MENTRA_PORT,
  });
  await active.start();
  getLogger().info({
    msg: 'glasses.appserver.listening',
    packageName: env.MENTRA_PACKAGE_NAME,
    port: env.MENTRA_PORT,
  });
  return active;
}

export async function stopGlassesAppServer(): Promise<void> {
  if (!active) return;
  try {
    await active.stop();
  } finally {
    active = undefined;
  }
}
