// HA proactive alert webhook — Flow 3 of the garden glasses session.
//
// HA posts to POST /garden/ha-alert when a zone threshold is breached.
// The raw body must arrive here before express.json() parses it so that
// we can compute the HMAC over the exact bytes HA signed.
//
// OWASP A08 — HMAC-SHA256 validated before touching any payload data.
// OWASP A03 — payload validated through zod before use.
// OWASP A01 — zone owner looked up from DB; only that user is spoken to.
// OWASP A09 — every webhook call (valid or rejected) is audit-logged.

import express from 'express';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { validateWebhookHmac } from '../homeAssistant/client';
import { auditLog, getLogger } from '../../../../base/backend/src/audit/logger';
import { loadEnv } from '../../../../base/backend/src/config/env';
import { GardenAppServer } from './gardenSession';

// ---- Payload schema (OWASP A03) ----

const AlertPayloadSchema = z.object({
  zoneId:  z.string().uuid(),
  trigger: z.string().min(1).max(100),
  value:   z.number().optional(),
});

// ---- Alert message formatter ----

function formatAlertMessage(trigger: string, value: number | undefined): string {
  const valStr = value !== undefined ? ` (${value})` : '';
  // Map common triggers to human-readable phrases spoken through glasses.
  const TRIGGER_MAP: Record<string, string> = {
    soil_moisture_low:  `Soil moisture is critically low${valStr}. Watering recommended.`,
    soil_moisture_high: `Soil moisture is too high${valStr}. Check for waterlogging.`,
    temperature_low:    `Temperature has dropped${valStr}. Consider enabling the heater.`,
    temperature_high:   `Temperature is too high${valStr}. Check ventilation.`,
    humidity_low:       `Humidity is low${valStr}.`,
    humidity_high:      `Humidity is very high${valStr}. Check for mould risk.`,
    ph_out_of_range:    `pH is out of range${valStr}. Check soil balance.`,
  };
  return TRIGGER_MAP[trigger] ?? `Garden alert: ${trigger}${valStr}.`;
}

// ---- Router factory ----

export function createAlertRouter(db: Database): express.Router {
  const router = express.Router();

  // express.raw() runs inline — this route must be mounted BEFORE express.json()
  // in the parent app so the body arrives as raw bytes for HMAC verification.
  router.post(
    '/ha-alert',
    express.raw({ type: '*/*', limit: '4kb' }),
    (req, res) => {
      const env = loadEnv();

      // If HA_WEBHOOK_SECRET is not configured, return 404 (same as disabled). OWASP A05
      if (!env.HA_WEBHOOK_SECRET) {
        res.status(404).end();
        return;
      }

      const sig = req.headers['x-ha-signature-256'];
      const rawBody = req.body as Buffer;

      if (
        typeof sig !== 'string' ||
        !validateWebhookHmac(rawBody, sig, env.HA_WEBHOOK_SECRET) // OWASP A08
      ) {
        auditLog({
          action: 'ha.alert_webhook',
          userId: 'unknown',
          result: 'denied',
          metadata: { reason: 'invalid_hmac' },
        });
        res.status(401).end();
        return;
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.status(400).end();
        return;
      }

      const payload = AlertPayloadSchema.safeParse(parsedBody); // OWASP A03
      if (!payload.success) {
        auditLog({
          action: 'ha.alert_webhook',
          userId: 'unknown',
          result: 'failure',
          metadata: { reason: 'invalid_payload' },
        });
        res.status(400).end();
        return;
      }

      const { zoneId, trigger, value } = payload.data;

      // Look up who owns this zone (OWASP A01).
      const row = db
        .prepare('SELECT user_id FROM garden_zones WHERE id = ?')
        .get(zoneId) as { user_id: string } | undefined;

      if (!row) {
        auditLog({
          action: 'ha.alert_webhook',
          userId: 'unknown',
          result: 'failure',
          metadata: { reason: 'zone_not_found', zoneId },
        });
        res.status(404).end();
        return;
      }

      const userId = row.user_id;
      const message = formatAlertMessage(trigger, value);

      auditLog({
        action: 'proactive_alert',
        userId,
        result: 'success',
        metadata: { zoneId, trigger, value },
      });

      // Fire-and-forget — respond 200 immediately; HA does not wait for TTS.
      GardenAppServer.speakAlert(userId, message).catch((err: unknown) => {
        getLogger().warn({
          msg: 'garden.alert.speak_failed',
          userId,
          zoneId,
          reason: err instanceof Error ? err.message : String(err),
        });
      });

      res.status(200).end();
    },
  );

  return router;
}
