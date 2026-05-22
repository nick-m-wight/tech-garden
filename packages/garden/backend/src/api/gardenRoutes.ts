// Garden REST API — zones, analyses, photos, HA actions.
//
// OWASP A01 — every route guarded by requireAuth; all DB queries scoped to userId.
// OWASP A02 — photo bytes decrypted server-side, returned only on authenticated request.
// OWASP A03 — request bodies validated through zod before use.
// OWASP A08 — PlantAnalysisResponse re-parsed through zod before serving.
// OWASP A09 — HA commands audit-logged by executeCommand().

import { Router } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import { requireAuth } from '../../../../base/backend/src/auth/middleware';
import { registerSseClient, notifyAnalysisReady } from './sse';
import { auditLog } from '../../../../base/backend/src/audit/logger';
import { getZonesByUserId, getZoneById } from '../homeAssistant/zones';
import { getAnalysesByUser, getAnalysisById, deleteAnalysis, saveAnalysis } from '../storage/plantHistory';
import { loadPhoto, getPhotoRecord, validateMagicBytes, deletePhoto, savePhoto, linkAnalysisToPhoto } from '../storage/photoStore';
import { PlantAnalysisResponseSchema, analysePlant, detectMediaType } from '../ai/plantAnalysis';
import { HAClient } from '../homeAssistant/client';
import { executeCommand, PERMITTED_COMMANDS } from '../homeAssistant/actuators';
import { GardenAppServer } from '../glasses/gardenSession';
import type { PermittedCommand } from '../homeAssistant/actuators';
import { getActuatorEntityId } from '../glasses/intentParser';

// ---- Request validation ----

const HaActionSchema = z.object({
  command: z.string().min(1).max(50),
  zoneId: z.string().uuid(),
});

const CropRectSchema = z.object({
  x:      z.number().min(0).max(1),
  y:      z.number().min(0).max(1),
  width:  z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const ReanalyzeSchema = z.object({
  imageBase64: z.string().min(1),
  cropRect: CropRectSchema.optional(),
  zoneId: z.string().uuid().optional(),
  speciesHint: z.string().min(1).max(100).optional(),
});

// ---- Router ----

export function createGardenRouter(db: Database): Router {
  const router = Router();

  // SSE stream — phone subscribes here; backend pushes analysis_ready events. OWASP A01.
  router.get('/events', requireAuth, (req, res) => {
    const userId = req.user!.userId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const unregister = registerSseClient(userId, res);

    // Keep-alive ping every 25 s — stays inside typical proxy 30 s timeouts.
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
    }, 25_000);

    req.on('close', () => {
      clearInterval(ping);
      unregister();
    });
  });

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
      analyses: analyses.map((a) => {
        let title: string | null = null;
        let species: string | null = null;
        try {
          const raw = JSON.parse(a.rawResponse) as Record<string, unknown>;
          if (typeof raw['title'] === 'string') title = raw['title'];
          if (typeof raw['species'] === 'string') species = raw['species'];
        } catch { /* rawResponse may be a minimal stub */ }
        return {
          analysisId: a.analysisId,
          photoId: a.photoId,
          timestamp: a.createdAt.toISOString(),
          overallHealth: a.diagnosis.overallHealth,
          title: title ?? a.spokenSummary,
          species,
          spokenSummary: a.spokenSummary,
          issueCount: a.diagnosis.issues.length,
        };
      }),
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
      title: full?.title ?? analysis.spokenSummary,
      species: full?.species ?? null,
      speciesConfidence: full?.speciesConfidence ?? 'low',
      diagnosis: analysis.diagnosis,
      recommendations: analysis.recommendations,
      annotationPoints: full?.annotationPoints ?? [],
      trimming: full?.trimming ?? { needed: false, areas: [] },
      wateringNeeds: full?.wateringNeeds ?? { status: 'unknown', recommendation: '' },
      spokenSummary: analysis.spokenSummary,
    });
  });

  // Analysis delete — permanent, removes photo file and DB row.
  // OWASP A01 — userId-scoped lookup before delete; 404 on miss (no user enumeration).
  router.delete('/analyses/:id', requireAuth, (req, res): void => {
    const userId = req.user!.userId;
    const analysisId = req.params['id'];

    if (!analysisId) {
      res.status(400).json({ error: 'missing id' });
      return;
    }

    const analysis = getAnalysisById(db, analysisId, userId);
    if (!analysis) {
      auditLog({
        action: 'garden.api.analysis_delete',
        userId,
        result: 'denied',
        metadata: { analysisId, reason: 'not_found_or_wrong_user' },
      });
      res.status(404).json({ error: 'not found' });
      return;
    }

    deletePhoto(db, analysis.photoId, userId);
    deleteAnalysis(db, analysisId, userId);

    res.status(204).send();
  });

  // Crop re-analyse — client sends a cropped base64 image, we run a fresh Claude Vision pass.
  // OWASP A01 — userId-scoped; A02 — photo encrypted at rest; A03 — image validated via magic bytes.
  router.post('/reanalyze', requireAuth, async (req, res): Promise<void> => {
    const parsed = ReanalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const userId = req.user!.userId;
    const { imageBase64, cropRect, zoneId: reqZoneId, speciesHint } = parsed.data;

    // Validate magic bytes on the original image (OWASP A03)
    try {
      detectMediaType(imageBase64);
    } catch {
      res.status(400).json({ error: 'unsupported image format' });
      return;
    }

    // Resolve zone for sensor context
    const zone = (reqZoneId ? getZoneById(db, reqZoneId, userId) : null)
      ?? getZonesByUserId(db, userId)[0]
      ?? null;

    // Apply pixel crop + resize with sharp
    let imageBuffer = Buffer.from(imageBase64, 'base64');
    let finalBase64 = imageBase64;
    try {
      if (cropRect) {
        const meta = await sharp(imageBuffer).metadata();
        const origW = meta.width  ?? 0;
        const origH = meta.height ?? 0;
        const left   = Math.round(cropRect.x      * origW);
        const top    = Math.round(cropRect.y      * origH);
        const width  = Math.max(1, Math.min(Math.round(cropRect.width  * origW), origW - left));
        const height = Math.max(1, Math.min(Math.round(cropRect.height * origH), origH - top));
        imageBuffer  = await sharp(imageBuffer)
          .extract({ left, top, width, height })
          .jpeg({ quality: 88 })
          .toBuffer();
      }
      // Resize to max 1024px on longest side before storing and sending to Claude.
      // Halves token cost with no meaningful loss for plant health analysis.
      const meta = await sharp(imageBuffer).metadata();
      const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (longSide > 1024) {
        imageBuffer = await sharp(imageBuffer)
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();
      }
      finalBase64 = imageBuffer.toString('base64');
    } catch (imgErr) {
      auditLog({
        action: 'garden.api.reanalyze',
        userId,
        result: 'failure',
        metadata: { reason: `image processing failed: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}` },
      });
      res.status(400).json({ error: 'image processing failed' });
      return;
    }

    // Encrypt and store the (possibly cropped) photo (OWASP A02)
    const photoRecord = savePhoto(db, {
      imageBuffer,
      userId,
      zoneId: zone?.id ?? undefined,
    });

    let analysis: Awaited<ReturnType<typeof analysePlant>>;
    try {
      analysis = await analysePlant({
        imageBase64: finalBase64,
        userId,
        zoneId: zone?.id ?? '',
        zoneName: zone?.name ?? 'Unknown zone',
        sensors: {},
        speciesHint,
      });
    } catch (err) {
      deletePhoto(db, photoRecord.photoId, userId);
      auditLog({
        action: 'garden.api.reanalyze',
        userId,
        result: 'failure',
        metadata: { reason: err instanceof Error ? err.message : String(err) },
      });
      res.status(503).json({ error: 'analysis failed' });
      return;
    }

    const analysisRecord = saveAnalysis(db, {
      photoId: photoRecord.photoId,
      userId,
      analysis,
      rawResponse: JSON.stringify(analysis),
    });
    linkAnalysisToPhoto(db, photoRecord.photoId, userId, analysisRecord.analysisId);

    notifyAnalysisReady(userId, analysisRecord.analysisId);
    void GardenAppServer.speakAlert(userId, analysis.spokenSummary).catch(() => {});

    auditLog({
      action: 'garden.api.reanalyze',
      userId,
      result: 'success',
      metadata: {
        photoId: photoRecord.photoId,
        analysisId: analysisRecord.analysisId,
        overallHealth: analysis.diagnosis.overallHealth,
      },
    });

    res.json({ analysisId: analysisRecord.analysisId, spokenSummary: analysis.spokenSummary });
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
