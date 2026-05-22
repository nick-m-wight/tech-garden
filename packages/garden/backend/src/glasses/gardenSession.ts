// Garden glasses session — extends GlassesAppServer with all 3 garden flows.
//
// Flow 1: Voice → sanitize → intent parse → HA sensor/actuator → speak.
// Flow 2: Button → requestPhoto → validate → store → Claude Vision → speak + emit.
// Flow 3: Active session registry queried by alertWebhook.ts for HA proactive alerts.
//
// OWASP A01 — all DB operations scoped to userId via store and HA layer functions.
// OWASP A03 — voice text sanitized before intent parsing; image validated via magic bytes.
// OWASP A09 — every flow outcome (success, skip, failure) is audit-logged.

import type { AppSession, ButtonPress } from '@mentra/sdk';
import type { Database } from 'better-sqlite3';
import {
  GlassesAppServer,
  type GlassesAppServerOptions,
} from '../../../../base/backend/src/glasses/session';
import { loadEnv } from '../../../../base/backend/src/config/env';
import { auditLog, getLogger } from '../../../../base/backend/src/audit/logger';
import { sanitizeUserText } from '../../../../base/backend/src/security/sanitize';
import { HAClient } from '../homeAssistant/client';
import { getZonesByUserId, type GardenZone } from '../homeAssistant/zones';
import { readSensor } from '../homeAssistant/sensors';
import { executeCommand } from '../homeAssistant/actuators';
import { savePhoto } from '../storage/photoStore';
import { saveAnalysis } from '../storage/plantHistory';
import { linkAnalysisToPhoto } from '../storage/photoStore';
import { analysePlant } from '../ai/plantAnalysis';
import { notifyAnalysisReady } from '../api/sse';
import sharp from 'sharp';
import { askFollowUp } from '../ai/followUp';
import type { SensorReadings } from '../ai/gardenExpert';
import {
  parseGardenIntent,
  stripWakeWord,
  findZone,
  getSensorEntityId,
  getActuatorEntityId,
  formatSensorResponse,
  formatActuatorResponse,
  type SensorKey,
} from './intentParser';

// ---- Conversation state ----

interface ConversationState {
  lastSpokenResponse: string | null;
  followUpContext: {
    analysisText: string;
    zoneName: string;
    expiresAt: number;
  } | null;
}

const FOLLOW_UP_TTL_MS = 5 * 60 * 1000;

// ---- Active session registry (Flow 3) ----

const activeSessions = new Map<string, AppSession>();

// ---- Sensor gathering helper ----

type NumericSensorKey = 'soilMoisture' | 'temperature' | 'humidity' | 'lightLevel' | 'pH';

const SENSOR_PAIRS: Array<[keyof GardenZone['sensors'], NumericSensorKey]> = [
  ['soilMoisture', 'soilMoisture'],
  ['temperature',  'temperature'],
  ['humidity',     'humidity'],
  ['lightLevel',   'lightLevel'],
  ['pH',           'pH'],
];

async function gatherZoneSensors(
  haClient: HAClient,
  db: Database,
  zone: GardenZone,
  userId: string,
): Promise<SensorReadings> {
  const readings: SensorReadings = {};
  for (const [zoneField, readingKey] of SENSOR_PAIRS) {
    const entityId = zone.sensors[zoneField];
    if (!entityId) continue;
    try {
      const r = await readSensor(haClient, db, entityId, userId, zone.id);
      const num = parseFloat(r.value);
      if (!isNaN(num)) readings[readingKey] = num;
    } catch {
      // Sensor unavailable — continue without it.
    }
  }
  return readings;
}

// ---- Flow handlers ----

async function handleVoice(
  session: AppSession,
  text: string,
  userId: string,
  db: Database,
  haClient: HAClient | undefined,
  sessionId: string,
  activeZoneState: { zoneId: string | null },
  conversationState: ConversationState,
): Promise<void> {
  // Wake word gate — silently ignore any transcription not addressed to the
  // system. Without this, the glasses mic re-transcribes the speaker output
  // and loops on "didn't understand" responses.
  const command = stripWakeWord(text);
  if (command === null) return;

  // Dev-only: log the raw command so transcription issues are visible in docker logs.
  if (process.env['NODE_ENV'] === 'development') {
    getLogger().info({ msg: 'garden.voice.command', command, userId, sessionId });
  }

  if (command === '') {
    // Wake word only — user is addressing the system but hasn't said a command yet.
    session.layouts.showTextWall('Try: check moisture in zone 1.');
    return;
  }

  if (!haClient) {
    await session.audio.speak('Home Assistant is not configured. Please set HA_BASE_URL and HA_TOKEN.');
    return;
  }

  const intent = parseGardenIntent(command);

  // Repeat last response — no zone needed.
  if (intent?.action === 'repeat') {
    const last = conversationState.lastSpokenResponse;
    if (last) {
      await session.audio.speak(last);
    } else {
      await session.audio.speak("I haven't said anything yet.");
    }
    return;
  }

  if (!intent) {
    // Follow-up question: if recent photo analysis context is available, send to Claude.
    const ctx = conversationState.followUpContext;
    if (ctx && Date.now() < ctx.expiresAt) {
      const reply = await askFollowUp({
        question: command,
        previousAnalysis: ctx.analysisText,
        zoneName: ctx.zoneName,
        userId,
      });
      conversationState.lastSpokenResponse = reply;
      await session.audio.speak(reply);
      session.layouts.showTextWall(reply.slice(0, 100));
      return;
    }

    auditLog({
      action: 'garden.voice.unrecognised',
      userId,
      result: 'failure',
      metadata: { sessionId, length: command.length },
    });
    const hint = "Didn't catch that. Try: check moisture in zone 1.";
    await session.audio.speak(hint);
    session.layouts.showTextWall(hint);
    return;
  }

  const zones = getZonesByUserId(db, userId);
  const zone = findZone(zones, intent.zoneQuery);
  if (!zone) {
    await session.audio.speak(`I don't have a zone matching "${intent.zoneQuery}".`);
    return;
  }

  // Track the last-mentioned zone for photo context (Flow 2).
  activeZoneState.zoneId = zone.id;

  if (intent.action === 'sensor_read') {
    const entityId = getSensorEntityId(zone, intent.sensorKey as SensorKey);
    if (!entityId) {
      await session.audio.speak(
        `Zone ${zone.name} doesn't have a ${intent.sensorKey} sensor configured.`,
      );
      return;
    }
    const reading = await readSensor(haClient, db, entityId, userId, zone.id);
    const reply = formatSensorResponse(intent.sensorKey as SensorKey, reading.value, reading.unit, zone.name);
    conversationState.lastSpokenResponse = reply;
    await session.audio.speak(reply);
    session.layouts.showTextWall(reply);
    return;
  }

  // actuator command
  const entityId = getActuatorEntityId(zone, intent.command);
  if (!entityId) {
    await session.audio.speak(
      `Zone ${zone.name} doesn't have an actuator for that command.`,
    );
    return;
  }
  await executeCommand(haClient, db, intent.command, entityId, userId, zone.id);
  const reply = formatActuatorResponse(intent.command, zone.name);
  conversationState.lastSpokenResponse = reply;
  await session.audio.speak(reply);
  session.layouts.showTextWall(reply);
}

async function handlePhoto(
  session: AppSession,
  userId: string,
  db: Database,
  haClient: HAClient | undefined,
  sessionId: string,
  activeZoneState: { zoneId: string | null },
  conversationState: ConversationState,
): Promise<void> {
  // Fire-and-forget: audio cue plays while photo is captured concurrently.
  void session.audio.speak('Taking a photo, please hold still.').catch(() => {});

  // Take the photo via SDK (resolves when glasses return the image).
  const photo = await session.camera.requestPhoto({ size: 'medium', saveToGallery: true });
  void session.audio.speak('Analysing your plant. One moment.').catch(() => {});

  // Find zone context for sensor readings.
  const zones = getZonesByUserId(db, userId);
  const activeZone =
    (activeZoneState.zoneId
      ? zones.find((z) => z.id === activeZoneState.zoneId)
      : undefined) ?? zones[0] ?? null;

  // Gather live sensor readings for analysis context (best-effort).
  const sensors: SensorReadings =
    haClient && activeZone
      ? await gatherZoneSensors(haClient, db, activeZone, userId)
      : {};

  // Resize to max 1024px before storing and sending to Claude (halves token cost).
  let photoBuffer = photo.buffer;
  try {
    const meta = await sharp(photoBuffer).metadata();
    const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longSide > 1024) {
      photoBuffer = await sharp(photoBuffer)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    }
  } catch {
    // Use original if resize fails.
  }

  // Encrypt and store the photo (OWASP A02, A03).
  const photoRecord = savePhoto(db, {
    imageBuffer: photoBuffer,
    userId,
    zoneId: activeZone?.id ?? undefined,
  });

  // Send to Claude Vision — gracefully degrade if API key is absent or call fails.
  const imageBase64 = photoBuffer.toString('base64');
  let analysis: Awaited<ReturnType<typeof analysePlant>>;
  let spokenSummary: string;
  try {
    analysis = await analysePlant({
      imageBase64,
      userId,
      zoneId: activeZone?.id ?? '',
      zoneName: activeZone?.name ?? 'Unknown zone',
      sensors,
    });
    spokenSummary = analysis.spokenSummary;
    // Open a 5-minute follow-up window so the user can ask questions about this analysis.
    conversationState.followUpContext = {
      analysisText: spokenSummary,
      zoneName: activeZone?.name ?? 'Unknown zone',
      expiresAt: Date.now() + FOLLOW_UP_TTL_MS,
    };
  } catch (claudeErr) {
    getLogger().warn({
      msg: 'garden.photo.claude_skipped',
      reason: claudeErr instanceof Error ? claudeErr.message : String(claudeErr),
    });
    // Stub analysis so the photo still appears in history on the phone.
    analysis = {
      title: 'Photo saved',
      species: 'Unknown',
      speciesConfidence: 'low',
      spokenSummary: 'Photo saved. Analysis unavailable.',
      diagnosis: { overallHealth: 'unknown' as never, issues: [] },
      recommendations: [],
      annotationPoints: [],
      trimming: { needed: false, areas: [] },
      wateringNeeds: { status: 'unknown', recommendation: 'Analysis unavailable.' },
    };
    spokenSummary = 'Photo saved.';
  }

  // Persist the analysis and link it to the photo.
  const analysisRecord = saveAnalysis(db, {
    photoId: photoRecord.photoId,
    userId,
    analysis,
    rawResponse: JSON.stringify(analysis),
  });
  linkAnalysisToPhoto(db, photoRecord.photoId, userId, analysisRecord.analysisId);
  notifyAnalysisReady(userId, analysisRecord.analysisId);

  // Speak the summary through the glasses.
  conversationState.lastSpokenResponse = spokenSummary;
  await session.audio.speak(spokenSummary);
  session.layouts.showTextWall(spokenSummary.slice(0, 100));

  auditLog({
    action: 'garden.photo.analysis',
    userId,
    result: 'success',
    metadata: {
      sessionId,
      photoId: photoRecord.photoId,
      analysisId: analysisRecord.analysisId,
      overallHealth: analysis.diagnosis.overallHealth,
    },
  });
}

// ---- GardenAppServer ----

export interface GardenAppServerOptions extends GlassesAppServerOptions {
  db: Database;
}

export class GardenAppServer extends GlassesAppServer {
  private readonly db: Database;
  private readonly haClient: HAClient | undefined;

  constructor(opts: GardenAppServerOptions) {
    super(opts);
    this.db = opts.db;
    try {
      this.haClient = new HAClient();
    } catch {
      getLogger().info({
        msg: 'garden.ha.client.skipped',
        reason: 'HA_BASE_URL / HA_TOKEN not configured — HA features disabled',
      });
    }

    // MentraOS loads this URL on the glasses display when the app is active.
    this.getExpressApp().get('/webview', (_req, res) => {
      const haStatus = this.haClient ? 'connected' : 'not configured';
      res.setHeader('Content-Type', 'text/html');
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#1a2e1a;color:#a8d5a2;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}h1{font-size:1.4rem;margin-bottom:.5rem}p{font-size:.9rem;opacity:.7}</style></head>
<body><div><h1>🌱 Garden</h1><p>HA: ${haStatus}</p><p>Press the button to analyse a plant.</p></div></body></html>`);
    });
  }

  protected async onSession(
    session: AppSession,
    sessionId: string,
    mentraUserId: string,  // MentraOS sends the user's email as userId
  ): Promise<void> {
    // Resolve MentraOS email → internal UUID so DB foreign keys match.
    const userRow = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(mentraUserId.toLowerCase()) as { id: string } | undefined;

    if (!userRow) {
      getLogger().warn({ msg: 'garden.session.unknown_user', mentraUserId });
      await session.audio.speak("Your account isn't registered in this garden system.");
      return;
    }
    const userId = userRow.id;

    activeSessions.set(userId, session);
    auditLog({
      action: 'garden.session.start',
      userId,
      result: 'success',
      metadata: { sessionId, mentraUserId },
    });

    const db = this.db;
    const haClient = this.haClient;
    const activeZoneState: { zoneId: string | null } = { zoneId: null };
    const conversationState: ConversationState = { lastSpokenResponse: null, followUpContext: null };
    let photoInProgress = false;
    let lastPhotoMs = 0;
    const PHOTO_COOLDOWN_MS = 5_000;

    // Flow 1 — Voice → HA
    const stopTranscription = session.events.onTranscription((data) => {
      if (!data.isFinal) return;
      const text = sanitizeUserText(data.text); // OWASP A03
      if (!text) return;

      handleVoice(session, text, userId, db, haClient, sessionId, activeZoneState, conversationState).catch(
        (err: unknown) => {
          auditLog({
            action: 'garden.voice.error',
            userId,
            result: 'failure',
            metadata: {
              sessionId,
              reason: err instanceof Error ? err.message : String(err),
            },
          });
          void session.audio.speak('Sorry, there was a problem with that command.').catch(
            () => { /* glasses may have disconnected */ },
          );
        },
      );
    });

    // Flow 2 — Button press → photo → Claude Vision
    // Time-based cooldown guards against the SDK firing two events per physical press.
    const stopButton = session.events.onButtonPress((_data: ButtonPress) => {
      const now = Date.now();
      if (photoInProgress || now - lastPhotoMs < PHOTO_COOLDOWN_MS) return;
      photoInProgress = true;
      lastPhotoMs = now;

      handlePhoto(session, userId, db, haClient, sessionId, activeZoneState, conversationState)
        .catch((err: unknown) => {
          auditLog({
            action: 'garden.photo.error',
            userId,
            result: 'failure',
            metadata: {
              sessionId,
              reason: err instanceof Error ? err.message : String(err),
            },
          });
          void session.audio.speak('Sorry, I had a problem with the photo analysis.').catch(
            () => { /* glasses may have disconnected */ },
          );
        })
        .finally(() => {
          photoInProgress = false;
        });
    });

    session.events.onDisconnected(() => {
      activeSessions.delete(userId);
      stopTranscription();
      stopButton();
      auditLog({
        action: 'garden.session.end',
        userId,
        result: 'success',
        metadata: { sessionId },
      });
    });
  }

  protected async onStop(sessionId: string, mentraUserId: string, reason: string): Promise<void> {
    // Resolve email → UUID (best-effort; may already be cleaned up by onDisconnected).
    const userRow = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(mentraUserId.toLowerCase()) as { id: string } | undefined;
    const userId = userRow?.id ?? mentraUserId;
    activeSessions.delete(userId);
    auditLog({
      action: 'garden.session.stop',
      userId,
      result: 'denied',
      metadata: { sessionId, reason },
    });
  }

  // Called by alertWebhook.ts to speak a proactive HA alert (Flow 3). // OWASP A09
  static async speakAlert(userId: string, text: string): Promise<boolean> {
    const session = activeSessions.get(userId);
    if (!session) return false;
    await session.audio.speak(text);
    return true;
  }

  static hasActiveSession(userId: string): boolean {
    return activeSessions.has(userId);
  }
}

// ---- Lifecycle helpers ----

let gardenServer: GardenAppServer | undefined;

export async function maybeStartGardenAppServer(
  db: Database,
): Promise<GardenAppServer | undefined> {
  const env = loadEnv();
  if (!env.MENTRA_PACKAGE_NAME || !env.MENTRA_API_KEY) {
    getLogger().info({
      msg: 'garden.appserver.skipped',
      reason: 'MENTRA_PACKAGE_NAME/MENTRA_API_KEY blank — set both to enable',
    });
    return undefined;
  }
  gardenServer = new GardenAppServer({
    packageName: env.MENTRA_PACKAGE_NAME,
    apiKey: env.MENTRA_API_KEY,
    port: env.MENTRA_PORT,
    db,
  });
  await gardenServer.start();
  getLogger().info({
    msg: 'garden.appserver.listening',
    packageName: env.MENTRA_PACKAGE_NAME,
    port: env.MENTRA_PORT,
  });
  return gardenServer;
}

export async function stopGardenAppServer(): Promise<void> {
  if (!gardenServer) return;
  try {
    await gardenServer.stop();
  } finally {
    gardenServer = undefined;
  }
}
