// E2E integration tests for garden glasses session flows.
//
// Step 15 — Flow 1: voice transcription → HA sensor read → speak response
// Step 16 — Flow 2: button press → photo capture → Claude Vision → speak + display
//
// All external dependencies (HA, Claude, MentraOS SDK, base backend) are mocked so
// the flows run in process without any live services.

import type { AppSession } from '@mentra/sdk';
import BetterSqlite3 from 'better-sqlite3';
import { GardenAppServer, type GardenAppServerOptions } from '../gardenSession';
import type { GardenZone } from '../../homeAssistant/zones';
import type { PlantAnalysisResponse } from '../../ai/plantAnalysis';
import { getZonesByUserId } from '../../homeAssistant/zones';
import { readSensor } from '../../homeAssistant/sensors';
import { savePhoto, linkAnalysisToPhoto } from '../../storage/photoStore';
import { saveAnalysis } from '../../storage/plantHistory';
import { analysePlant } from '../../ai/plantAnalysis';

// ---- Module mocks --------------------------------------------------------

jest.mock('../../../../../base/backend/src/glasses/session', () => {
  class GlassesAppServer {
    constructor(_opts: unknown) {}
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  }
  return { GlassesAppServer };
});

jest.mock('../../../../../base/backend/src/config/env', () => ({
  loadEnv: () => ({ MENTRA_PACKAGE_NAME: '', MENTRA_API_KEY: '', MENTRA_PORT: 3001 }),
}));

jest.mock('../../../../../base/backend/src/audit/logger', () => ({
  auditLog: jest.fn(),
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../../../../base/backend/src/security/sanitize', () => ({
  sanitizeUserText: (t: string) => t,
}));

jest.mock('../../homeAssistant/client', () => ({
  HAClient: jest.fn().mockImplementation(() => ({
    getState: jest.fn(),
    callService: jest.fn(),
  })),
}));

jest.mock('../../homeAssistant/zones', () => ({ getZonesByUserId: jest.fn() }));
jest.mock('../../homeAssistant/sensors', () => ({ readSensor: jest.fn() }));
jest.mock('../../homeAssistant/actuators', () => ({ executeCommand: jest.fn() }));

jest.mock('../../storage/photoStore', () => ({
  savePhoto: jest.fn(),
  linkAnalysisToPhoto: jest.fn(),
}));
jest.mock('../../storage/plantHistory', () => ({ saveAnalysis: jest.fn() }));
jest.mock('../../ai/plantAnalysis', () => ({ analysePlant: jest.fn() }));

// ---- Helpers -------------------------------------------------------------

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 50));

function makeTestZone(): GardenZone {
  return {
    id: 'zone-1',
    userId: 'user-1',
    name: 'Zone 1',
    sensors: {
      soilMoisture: 'sensor.zone1_moisture',
      temperature:  'sensor.zone1_temp',
      humidity:     undefined,
      lightLevel:   undefined,
      pH:           undefined,
      npk:          undefined,
      rain:         undefined,
    },
    actuators: {
      waterValve: 'switch.zone1_water',
      growLight:  undefined,
      fan:        undefined,
      heater:     undefined,
    },
  };
}

function makeJpegBuffer(): Buffer {
  const buf = Buffer.alloc(64, 0x00);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xe0;
  return buf;
}

type TranscriptionCb = (data: { isFinal: boolean; text: string }) => void;
type ButtonPressCb   = (data: { buttonId: string; timestamp: number }) => void;

interface SessionMock {
  session: AppSession;
  triggerTranscription: (text: string) => void;
  triggerButtonPress: () => void;
  mockSpeak: jest.Mock;
  mockShowTextWall: jest.Mock;
  mockRequestPhoto: jest.Mock;
}

function makeMockSession(): SessionMock {
  let transcriptionCb: TranscriptionCb | null = null;
  let buttonPressCb:   ButtonPressCb   | null = null;

  const mockSpeak        = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const mockShowTextWall = jest.fn<void, [string]>();
  const mockRequestPhoto = jest.fn();

  const session = {
    audio:   { speak: mockSpeak },
    layouts: { showTextWall: mockShowTextWall },
    camera:  { requestPhoto: mockRequestPhoto },
    events: {
      onTranscription: jest.fn((cb: TranscriptionCb) => {
        transcriptionCb = cb;
        return () => { transcriptionCb = null; };
      }),
      onButtonPress: jest.fn((cb: ButtonPressCb) => {
        buttonPressCb = cb;
        return () => { buttonPressCb = null; };
      }),
      onDisconnected: jest.fn((_cb: () => void) => jest.fn()),
    },
  } as unknown as AppSession;

  return {
    session,
    triggerTranscription: (text: string) =>
      transcriptionCb?.({ isFinal: true, text }),
    triggerButtonPress: () =>
      buttonPressCb?.({ buttonId: 'main', timestamp: Date.now() }),
    mockSpeak,
    mockShowTextWall,
    mockRequestPhoto,
  };
}

// TestableGardenAppServer widens the protected onSession to public for tests.
class TestableGardenAppServer extends GardenAppServer {
  public override async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    return super.onSession(session, sessionId, userId);
  }
}

function makeServer(): TestableGardenAppServer {
  const db = new BetterSqlite3(':memory:');
  const opts: GardenAppServerOptions = {
    db,
    packageName: 'test-pkg',
    apiKey: 'test-api-key',
    port: 3001,
  };
  return new TestableGardenAppServer(opts);
}

const mockGetZonesByUserId = jest.mocked(getZonesByUserId);
const mockReadSensor       = jest.mocked(readSensor);
const mockSavePhoto        = savePhoto        as jest.Mock;
const mockSaveAnalysis     = saveAnalysis     as jest.Mock;
const mockLinkAnalysis     = linkAnalysisToPhoto as jest.Mock;
const mockAnalysePlant     = jest.mocked(analysePlant);

// ---- Flow 1 — voice → HA sensor read → speak (step 15) ------------------

describe('Flow 1 — voice transcription → HA sensor read → speak', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetZonesByUserId.mockReturnValue([makeTestZone()]);
  });

  it('reads soil moisture and speaks the value back through the glasses', async () => {
    mockReadSensor.mockResolvedValue({
      entityId: 'sensor.zone1_moisture',
      value: '42',
      unit: '%',
      recordedAt: new Date(),
    });

    const server = makeServer();
    const { session, triggerTranscription, mockSpeak, mockShowTextWall } = makeMockSession();
    await server.onSession(session, 'sess-1', 'user-1');

    triggerTranscription('check moisture in zone 1');
    await flushPromises();

    // OWASP A09 — intent executed and result spoken
    expect(mockSpeak).toHaveBeenCalledWith(expect.stringContaining('42'));
    expect(mockShowTextWall).toHaveBeenCalled();
    expect(mockReadSensor).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'sensor.zone1_moisture',
      'user-1',
      'zone-1',
    );
  });

  it('ignores non-final transcription events', async () => {
    const server = makeServer();
    const { session, mockSpeak } = makeMockSession();
    await server.onSession(session, 'sess-2', 'user-1');

    // Retrieve the handler registered by onSession and fire it with isFinal=false
    const registeredCb = (session.events.onTranscription as jest.Mock).mock.calls[0]?.[0] as
      | TranscriptionCb
      | undefined;
    registeredCb?.({ isFinal: false, text: 'check mo...' });
    await flushPromises();

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('speaks a fallback when HA is not configured', async () => {
    // Make HAClient constructor throw so haClient stays undefined in the server
    const { HAClient } = jest.requireMock('../../homeAssistant/client') as {
      HAClient: jest.Mock;
    };
    HAClient.mockImplementationOnce(() => { throw new Error('not configured'); });

    const server = makeServer();
    const { session, triggerTranscription, mockSpeak } = makeMockSession();
    await server.onSession(session, 'sess-3', 'user-1');

    triggerTranscription('check moisture in zone 1');
    await flushPromises();

    expect(mockSpeak).toHaveBeenCalledWith(
      expect.stringContaining('Home Assistant is not configured'),
    );
  });
});

// ---- Flow 2 — button press → photo → Claude Vision → speak (step 16) ----

describe('Flow 2 — button press → photo capture → Claude Vision → speak', () => {
  const fakeAnalysis: PlantAnalysisResponse = {
    spokenSummary: 'I see early signs of powdery mildew on the upper leaves.',
    diagnosis: {
      overallHealth: 'fair',
      issues: [
        { type: 'disease', severity: 'medium', description: 'Powdery mildew on upper leaves' },
      ],
    },
    recommendations: [
      { action: 'Apply fungicide', priority: 'soon', detail: 'Use sulfur-based spray.' },
    ],
    annotationPoints: [{ x: 0.5, y: 0.3, label: 'Mildew', color: '#ff0000' }],
    trimming: { needed: false, areas: [] },
    wateringNeeds: { status: 'optimal', recommendation: 'No watering needed this week.' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetZonesByUserId.mockReturnValue([makeTestZone()]);
    mockSavePhoto.mockReturnValue({ photoId: 'photo-1' });
    mockSaveAnalysis.mockReturnValue({ analysisId: 'analysis-1' });
    mockLinkAnalysis.mockReturnValue(undefined);
    mockAnalysePlant.mockResolvedValue(fakeAnalysis);
  });

  it('requests a photo, sends it to Claude Vision, and speaks the analysis summary', async () => {
    const server = makeServer();
    const { session, triggerButtonPress, mockSpeak, mockShowTextWall, mockRequestPhoto } =
      makeMockSession();
    await server.onSession(session, 'sess-4', 'user-1');

    mockRequestPhoto.mockResolvedValue({ buffer: makeJpegBuffer() });

    triggerButtonPress();
    await flushPromises();

    // OWASP A03 — photo captured and passed to Claude
    expect(mockRequestPhoto).toHaveBeenCalled();
    expect(mockAnalysePlant).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', zoneName: 'Zone 1' }),
    );
    // OWASP A09 — spoken summary and display updated
    expect(mockSpeak).toHaveBeenCalledWith(fakeAnalysis.spokenSummary);
    expect(mockShowTextWall).toHaveBeenCalledWith(
      expect.stringContaining('powdery mildew'),
    );
  });

  it('persists the analysis and links it to the photo record', async () => {
    const server = makeServer();
    const { session, triggerButtonPress, mockRequestPhoto } = makeMockSession();
    await server.onSession(session, 'sess-5', 'user-1');

    mockRequestPhoto.mockResolvedValue({ buffer: makeJpegBuffer() });

    triggerButtonPress();
    await flushPromises();

    // OWASP A02 — photo stored encrypted; A09 — analysis persisted and linked
    expect(mockSavePhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1', imageBuffer: expect.any(Buffer) }),
    );
    expect(mockSaveAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ photoId: 'photo-1', userId: 'user-1' }),
    );
    expect(mockLinkAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      'photo-1',
      'user-1',
      'analysis-1',
    );
  });

  it('debounces concurrent button presses — only one photo request is issued', async () => {
    const server = makeServer();
    const { session, triggerButtonPress, mockRequestPhoto } = makeMockSession();
    await server.onSession(session, 'sess-6', 'user-1');

    // requestPhoto never resolves — simulates a slow capture in progress
    mockRequestPhoto.mockReturnValue(new Promise<never>(() => {}));

    triggerButtonPress();
    triggerButtonPress(); // second press while first is in flight
    triggerButtonPress(); // third press

    expect(mockRequestPhoto).toHaveBeenCalledTimes(1);
  });
});
