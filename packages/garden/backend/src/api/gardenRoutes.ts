// Garden REST API — zones, analyses, photos, HA actions.
//
// OWASP A01 — every route guarded by requireAuth; all DB queries scoped to userId.
// OWASP A02 — photo bytes decrypted server-side, returned only on authenticated request.
// OWASP A03 — request bodies validated through zod before use.
// OWASP A08 — PlantAnalysisResponse re-parsed through zod before serving.
// OWASP A09 — HA commands audit-logged by executeCommand().

import { Router } from 'express';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { requireAuth } from '../../../../base/backend/src/auth/middleware';
import { auditLog } from '../../../../base/backend/src/audit/logger';
import { getZonesByUserId, getZoneById } from '../homeAssistant/zones';
import { getAnalysesByUser, getAnalysisById } from '../storage/plantHistory';
import { loadPhoto, getPhotoRecord, validateMagicBytes } from '../storage/photoStore';
import { PlantAnalysisResponseSchema } from '../ai/plantAnalysis';
import { HAClient } from '../homeAssistant/client';
import { executeCommand, PERMITTED_COMMANDS } from '../homeAssistant/actuators';
import type { PermittedCommand } from '../homeAssistant/actuators';
import { getActuatorEntityId } from '../glasses/intentParser';

// ---- Request validation ----

const HaActionSchema = z.object({
  command: z.string().min(1).max(50),
  zoneId: z.string().uuid(),
});

// ---- Router ----

export function createGardenRouter(db: Database): Router {
  const router = Router();

  // Zones — config only, no live HA reads.
  router.get('/zones', requireAuth, (req, res) => {
    const userId = req.user!.userId;
    const zones = getZonesByUserId(db, userId);

    auditLog({
      action: 'garden.api.zones',
      userId,
      result: 'success',
      metadata: { count: zones.length },
    });

    res.json({
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        configuredSensors: (Object.entries(z.sensors) as Array<[string, string | undefined]>)
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k),
        configuredActuators: (Object.entries(z.actuators) as Array<[string, string | undefined]>)
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k),
      })),
    });
  });

  // Analysis list — summaries only, newest first.
  router.get('/analyses', requireAuth, (req, res) => {
    const userId = req.user!.userId;
    const limit = Math.min(
      parseInt(String(req.query['limit'] ?? '20'), 10) || 20,
      100,
    );

    const analyses = getAnalysesByUser(db, userId).slice(0, limit);

    res.json({
      analyses: analyses.map((a) => ({
        analysisId: a.analysisId,
        photoId: a.photoId,
        timestamp: a.createdAt.toISOString(),
        overallHealth: a.diagnosis.overallHealth,
        spokenSummary: a.spokenSummary,
        issueCount: a.diagnosis.issues.length,
      })),
    });
  });

  // Analysis detail — includes decrypted photo base64.
  router.get('/analyses/:id', requireAuth, (req, res) => {
    const userId = req.user!.userId;
    const analysisId = req.params['id'];

    if (!analysisId) {
      res.status(400).json({ error: 'missing id' });
      return;
    }

    const analysis = getAnalysisById(db, analysisId, userId);
    if (!analysis) {
      auditLog({
        action: 'garden.api.analysis_detail',
        userId,
        result: 'denied',
        metadata: { analysisId, reason: 'not_found_or_wrong_user' },
      });
      res.status(404).json({ error: 'not found' });
      return;
    }

    // Re-validate raw response through zod before serving (OWASP A08).
    let full: ReturnType<typeof PlantAnalysisResponseSchema.parse> | null = null;
    try {
      full = PlantAnalysisResponseSchema.parse(JSON.parse(analysis.rawResponse));
    } catch {
      // rawResponse may be a minimal stub — serve without extra fields.
    }

    // Decrypt photo (OWASP A02). Photo may be absent if retention cron deleted it.
    let photoBase64: string | null = null;
    let photoMimeType: string = 'image/jpeg';
    const photoRecord = getPhotoRecord(db, analysis.photoId, userId);
    if (photoRecord) {
      try {
        const buf = loadPhoto(db, analysis.photoId, userId);
        photoBase64 = buf.toString('base64');
        try {
          photoMimeType = validateMagicBytes(buf);
        } catch {
          // keep 'image/jpeg' default
        }
      } catch {
        // Photo file deleted by retention cron — return null.
      }
    }

    auditLog({
      action: 'garden.api.analysis_detail',
      userId,
      result: 'success',
      metadata: { analysisId },
    });

    res.json({
      analysisId: analysis.analysisId,
      photoId: analysis.photoId,
      photoBase64,
      photoMimeType,
      timestamp: analysis.createdAt.toISOString(),
      diagnosis: analysis.diagnosis,
      recommendations: analysis.recommendations,
      annotationPoints: full?.annotationPoints ?? [],
      trimming: full?.trimming ?? { needed: false, areas: [] },
      wateringNeeds: full?.wateringNeeds ?? { status: 'unknown', recommendation: '' },
      spokenSummary: analysis.spokenSummary,
    });
  });

  // HA action — triggered by "Send to HA" button on phone.
  router.post('/ha-action', requireAuth, (req, res): void => {
    const parsed = HaActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const userId = req.user!.userId;
    const { command, zoneId } = parsed.data;

    // Validate command against whitelist (OWASP A03).
    if (!(PERMITTED_COMMANDS as readonly string[]).includes(command) || command === 'read_sensor') {
      res.status(400).json({ error: 'invalid command' });
      return;
    }

    const zone = getZoneById(db, zoneId, userId);
    if (!zone) {
      res.status(404).json({ error: 'zone not found' });
      return;
    }

    const entityId = getActuatorEntityId(zone, command as PermittedCommand);
    if (!entityId) {
      res.status(400).json({ error: 'command not configured for this zone' });
      return;
    }

    // Fire-and-forget HA call — respond immediately; HA may be slow.
    let client: HAClient;
    try {
      client = new HAClient();
    } catch {
      res.status(503).json({ error: 'Home Assistant is not configured' });
      return;
    }

    executeCommand(client, db, command as PermittedCommand, entityId, userId, zoneId)
      .then(() => {
        res.json({ status: 'ok' });
      })
      .catch((err: unknown) => {
        auditLog({
          action: 'garden.api.ha_action',
          userId,
          result: 'failure',
          metadata: {
            command,
            zoneId,
            reason: err instanceof Error ? err.message : String(err),
          },
        });
        if (!res.headersSent) {
          res.status(503).json({ error: 'HA command failed' });
        }
      });
  });

  return router;
}
