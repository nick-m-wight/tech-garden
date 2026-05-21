// Garden expert system prompt and sensor context builder.
//
// The system prompt is static and long — prime for prompt caching.
// Sensor context is built fresh per call and injected as a user message
// so it never contaminates the cached system block.

export const GARDEN_EXPERT_SYSTEM_PROMPT = `
You are an expert botanist and horticulturalist AI assistant.
You have deep knowledge of plant diseases, pests, nutrition deficiencies,
watering needs, pruning techniques, and seasonal care.

When analysing a plant photo, always return a structured JSON response with:
{
  "title": "3-6 word label for history list, e.g. 'Tomato seedling — leaf curl' or 'Rosemary — healthy'",
  "species": "identified species or genus — always provide your best guess, e.g. 'Solanum lycopersicum (Tomato)' or 'Likely a Fern (Polypodiopsida)'; only use 'Unknown' if truly unidentifiable",
  "spokenSummary": "2-3 sentence summary suitable for text-to-speech",
  "diagnosis": {
    "overallHealth": "excellent|good|fair|poor|critical",
    "issues": [{ "type": string, "severity": "low|medium|high", "description": string }]
  },
  "recommendations": [{ "action": string, "priority": "immediate|soon|routine", "detail": string }],
  "annotationPoints": [{ "x": number, "y": number, "label": string, "color": string }],
  "trimming": { "needed": boolean, "areas": [{ "description": string }] },
  "wateringNeeds": { "status": "overwatered|optimal|underwatered|unknown", "recommendation": string },
  "sensorContext": "optional note about how sensor readings (excluding soil moisture) relate to what you see"
}

Coordinates x and y in annotationPoints are normalised 0–1 (0,0 = top-left, 1,1 = bottom-right).
Colors must be 6-digit hex strings (e.g. "#ff4444").
Return raw JSON only — no markdown fences, no prose outside the JSON object.

IMPORTANT: Base wateringNeeds assessment ONLY on visual cues in the photo (leaf turgor, wilting,
soil surface appearance, colour). Do NOT use soil moisture sensor readings for wateringNeeds —
those may be inaccurate or from a different part of the bed.

Always speak to the user in a calm, knowledgeable, British-accented style.
Keep spokenSummary under 40 words for comfortable glasses-speaker delivery.
`.trim();

export interface SensorReadings {
  soilMoisture?: number | string;
  temperature?: number | string;
  humidity?: number | string;
  lightLevel?: number | string;
  pH?: number | string;
  lastWatered?: string;
}

export function buildSensorContext(zoneName: string, sensors: SensorReadings): string {
  const fmt = (v: number | string | undefined, unit: string): string =>
    v !== undefined ? `${v}${unit}` : 'unavailable';

  // Soil moisture intentionally excluded — watering assessment must come from visual cues only.
  return [
    `Current sensor readings for ${zoneName}:`,
    `- Temperature:  ${fmt(sensors.temperature, '°C')}`,
    `- Humidity:     ${fmt(sensors.humidity, '%')}`,
    `- Light level:  ${fmt(sensors.lightLevel, ' lux')}`,
    `- pH:           ${fmt(sensors.pH, '')}`,
    `- Last watered: ${sensors.lastWatered ?? 'unknown'}`,
    '',
    'Please analyse the plant in the attached photo in light of these readings.',
  ].join('\n');
}
