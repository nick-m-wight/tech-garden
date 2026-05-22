import {
  buildSensorContext,
} from '../gardenExpert';
import {
  detectMediaType,
  parsePlantAnalysisResponse,
} from '../plantAnalysis';
import { formatForPhone } from '../imageAnnotation';
import type { PlantAnalysisResponse } from '../plantAnalysis';

// ---- buildSensorContext ----

describe('buildSensorContext', () => {
  it('formats all sensor values with units', () => {
    const ctx = buildSensorContext('Zone 1 — Raised Bed', {
      soilMoisture: 42,
      temperature: 18.5,
      humidity: 70,
      lightLevel: 1200,
      pH: 6.8,
      lastWatered: '2026-05-17 08:00',
    });
    expect(ctx).toContain('Zone 1 — Raised Bed');
    expect(ctx).toContain('42%');
    expect(ctx).toContain('18.5°C');
    expect(ctx).toContain('70%');
    expect(ctx).toContain('1200 lux');
    expect(ctx).toContain('6.8');
    expect(ctx).toContain('2026-05-17 08:00');
  });

  it('shows "unavailable" for missing sensors', () => {
    const ctx = buildSensorContext('Zone 2', {});
    expect(ctx).toContain('Soil moisture: unavailable');
    expect(ctx).toContain('Temperature:   unavailable');
    expect(ctx).toContain('Last watered:  unknown');
  });

  it('ends with the analysis instruction', () => {
    const ctx = buildSensorContext('Z', {});
    expect(ctx).toContain('Please analyse the plant');
  });
});

// ---- detectMediaType ----

describe('detectMediaType', () => {
  // JPEG magic: FF D8 FF + padding
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03]);

  it('detects JPEG from magic bytes', () => {
    expect(detectMediaType(jpegBytes.toString('base64'))).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    expect(detectMediaType(pngBytes.toString('base64'))).toBe('image/png');
  });

  it('throws for unknown image format', () => {
    expect(() => detectMediaType(garbage.toString('base64'))).toThrow(
      'Unsupported image format',
    );
  });

  it('throws for empty input', () => {
    expect(() => detectMediaType('')).toThrow();
  });
});

// ---- parsePlantAnalysisResponse ----

const VALID_RESPONSE: PlantAnalysisResponse = {
  title: 'Healthy plant — underwatering',
  species: 'Unknown',
  speciesConfidence: 'low',
  spokenSummary: 'The plant looks healthy with minor signs of underwatering.',
  diagnosis: {
    overallHealth: 'good',
    issues: [
      { type: 'underwatering', severity: 'low', description: 'Slight leaf curl.' },
    ],
  },
  recommendations: [
    { action: 'Water plant', priority: 'soon', detail: 'Increase watering frequency.' },
  ],
  annotationPoints: [
    { x: 0.3, y: 0.6, label: 'Leaf curl', color: '#ffaa00' },
  ],
  trimming: { needed: false, areas: [] },
  wateringNeeds: { status: 'underwatered', recommendation: 'Water twice a week.' },
};

describe('parsePlantAnalysisResponse', () => {
  it('parses a valid JSON response', () => {
    const result = parsePlantAnalysisResponse(JSON.stringify(VALID_RESPONSE));
    expect(result.diagnosis.overallHealth).toBe('good');
    expect(result.spokenSummary).toBe(VALID_RESPONSE.spokenSummary);
  });

  it('strips markdown code fences before parsing', () => {
    const wrapped = `\`\`\`json\n${JSON.stringify(VALID_RESPONSE)}\n\`\`\``;
    const result = parsePlantAnalysisResponse(wrapped);
    expect(result.diagnosis.overallHealth).toBe('good');
  });

  it('strips plain code fences before parsing', () => {
    const wrapped = `\`\`\`\n${JSON.stringify(VALID_RESPONSE)}\n\`\`\``;
    expect(parsePlantAnalysisResponse(wrapped).diagnosis.overallHealth).toBe('good');
  });

  it('throws on non-JSON text', () => {
    expect(() => parsePlantAnalysisResponse('not json at all')).toThrow(
      'not valid JSON',
    );
  });

  it('throws when overallHealth is an invalid enum value', () => {
    const bad = { ...VALID_RESPONSE, diagnosis: { ...VALID_RESPONSE.diagnosis, overallHealth: 'meh' } };
    expect(() => parsePlantAnalysisResponse(JSON.stringify(bad))).toThrow();
  });

  it('throws when annotationPoint color is not a hex string', () => {
    const bad = {
      ...VALID_RESPONSE,
      annotationPoints: [{ x: 0.5, y: 0.5, label: 'test', color: 'red' }],
    };
    expect(() => parsePlantAnalysisResponse(JSON.stringify(bad))).toThrow();
  });

  it('throws when annotation coordinates are out of 0-1 range', () => {
    const bad = {
      ...VALID_RESPONSE,
      annotationPoints: [{ x: 1.5, y: 0.5, label: 'test', color: '#ff0000' }],
    };
    expect(() => parsePlantAnalysisResponse(JSON.stringify(bad))).toThrow();
  });

  it('accepts an optional sensorContext field', () => {
    const withCtx = { ...VALID_RESPONSE, sensorContext: 'Moisture is low.' };
    const result = parsePlantAnalysisResponse(JSON.stringify(withCtx));
    expect(result.sensorContext).toBe('Moisture is low.');
  });

  it('accepts a missing sensorContext field', () => {
    const result = parsePlantAnalysisResponse(JSON.stringify(VALID_RESPONSE));
    expect(result.sensorContext).toBeUndefined();
  });
});

// ---- formatForPhone ----

describe('formatForPhone', () => {
  it('returns all required phone payload fields', () => {
    const payload = formatForPhone(VALID_RESPONSE);
    expect(payload.spokenSummary).toBe(VALID_RESPONSE.spokenSummary);
    expect(payload.annotationPoints).toEqual(VALID_RESPONSE.annotationPoints);
    expect(payload.diagnosis).toEqual(VALID_RESPONSE.diagnosis);
    expect(payload.recommendations).toEqual(VALID_RESPONSE.recommendations);
    expect(payload.trimming).toEqual(VALID_RESPONSE.trimming);
    expect(payload.wateringNeeds).toEqual(VALID_RESPONSE.wateringNeeds);
  });

  it('passes annotation points through unchanged', () => {
    const payload = formatForPhone(VALID_RESPONSE);
    expect(payload.annotationPoints[0]).toEqual({ x: 0.3, y: 0.6, label: 'Leaf curl', color: '#ffaa00' });
  });
});
