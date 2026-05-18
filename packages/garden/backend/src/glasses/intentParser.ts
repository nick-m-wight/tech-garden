// Voice intent parser — keyword-based, < 50 ms, no AI call.
//
// OWASP A03 — raw text never reaches HA or DB; only the structured intent
//             (zone ID, entity ID, command) passes to the downstream layer.

import type { GardenZone } from '../homeAssistant/zones';
import type { PermittedCommand } from '../homeAssistant/actuators';

// ---- Sensor keys ----

export type SensorKey = 'soilMoisture' | 'temperature' | 'humidity' | 'lightLevel' | 'pH';

const SENSOR_PATTERNS: Array<[RegExp, SensorKey]> = [
  [/\b(?:soil\s+)?moist(?:ure)?\b|\bwet\b|\bdry\b/i,  'soilMoisture'],
  [/\btemper(?:ature)?\b|\btemp\b|\bheat\b/i,           'temperature'],
  [/\bhumid(?:ity)?\b/i,                                 'humidity'],
  [/\b(?:light|brightness|lux|sun(?:light)?)\b/i,        'lightLevel'],
  [/\bp[hH]\b|\bacid(?:ity)?\b|\balkalin(?:e|ity)\b/i,  'pH'],
];

function detectSensorKey(text: string): SensorKey | null {
  for (const [re, key] of SENSOR_PATTERNS) {
    if (re.test(text)) return key;
  }
  return null;
}

// ---- Actuator detection ----

type DeviceType = 'water' | 'light' | 'fan' | 'heater';

const DEVICE_PATTERNS: Array<[RegExp, DeviceType]> = [
  [/\b(?:water(?:ing)?|irrig(?:ation|ate)|sprinkler)\b/i, 'water'],
  [/\b(?:lights?|lamp|grow\s+lights?)\b/i,                'light'],
  [/\bfan\b/i,                                            'fan'],
  [/\bheater?\b|\bheating\b/i,                            'heater'],
];

const DEVICE_ON_MAP: Record<DeviceType, PermittedCommand> = {
  water:  'turn_on_water',
  light:  'turn_on_light',
  fan:    'turn_on_fan',
  heater: 'turn_on_heater',
};
const DEVICE_OFF_MAP: Record<DeviceType, PermittedCommand> = {
  water:  'turn_off_water',
  light:  'turn_off_light',
  fan:    'turn_off_fan',
  heater: 'turn_off_heater',
};

const TURN_ON_RE  = /\b(?:turn\s+on|start|activate|open|run)\b/i;
const TURN_OFF_RE = /\b(?:turn\s+off|stop|deactivate|close|shut\s+off)\b/i;

function detectActuatorCommand(text: string): PermittedCommand | null {
  let device: DeviceType | null = null;
  for (const [re, d] of DEVICE_PATTERNS) {
    if (re.test(text)) { device = d; break; }
  }
  if (!device) return null;

  const on  = TURN_ON_RE.test(text);
  const off = TURN_OFF_RE.test(text);
  if (on && !off)  return DEVICE_ON_MAP[device];
  if (off && !on)  return DEVICE_OFF_MAP[device];
  return null; // ambiguous
}

// ---- Zone extraction ----

const ZONE_RES: RegExp[] = [
  /\bin\s+zone\s+([\w\s]+?)(?:\s*$|\s+(?:please|now|for\s+me))/i,
  /\bfor\s+zone\s+([\w\s]+?)(?:\s*$|\s+(?:please|now))/i,
  /\bzone\s+([\w\s]+?)(?:\s*$|\s+(?:please|now|sensor|moisture|temp|light))/i,
  /\bin\s+the\s+([\w\s]+?)(?:\s*$|\s+(?:zone|please|now|area))/i,
];

const SPOKEN_DIGITS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

export function extractZoneQuery(text: string): string | null {
  for (const re of ZONE_RES) {
    const m = re.exec(text);
    if (m?.[1]) {
      const raw = m[1].trim().toLowerCase();
      return SPOKEN_DIGITS[raw] ?? raw;
    }
  }
  return null;
}

// ---- Intent types ----

export type ParsedIntent =
  | { action: 'sensor_read'; sensorKey: SensorKey; zoneQuery: string }
  | { action: 'actuator'; command: PermittedCommand; zoneQuery: string };

const SENSOR_READ_RE =
  /\b(?:check|read|what(?:'?s)?(?:\s+the)?|how(?:'?s)?(?:\s+(?:the|is))?|tell\s+me|show\s+me|what\s+is|how\s+is)\b/i;

export function parseGardenIntent(text: string): ParsedIntent | null {
  const zoneQuery = extractZoneQuery(text);
  if (!zoneQuery) return null;

  // Actuator commands are more specific — try first.
  const command = detectActuatorCommand(text);
  if (command) return { action: 'actuator', command, zoneQuery };

  // Sensor read: requires a read verb + a recognisable sensor word.
  if (SENSOR_READ_RE.test(text)) {
    const sensorKey = detectSensorKey(text);
    if (sensorKey) return { action: 'sensor_read', sensorKey, zoneQuery };
  }

  return null;
}

// ---- Zone matching ----

export function findZone(zones: GardenZone[], query: string): GardenZone | null {
  const q = query.toLowerCase().trim();

  // Exact name match (case-insensitive).
  const exact = zones.find((z) => z.name.toLowerCase() === q);
  if (exact) return exact;

  // Numeric: "2" → zone whose name contains "2", then the 2nd zone by insertion order.
  const num = parseInt(q, 10);
  if (!isNaN(num) && num > 0) {
    const byName = zones.find((z) => z.name.includes(q));
    if (byName) return byName;
    const byIndex = zones[num - 1] ?? null;
    if (byIndex) return byIndex;
  }

  // Substring match.
  return zones.find((z) => z.name.toLowerCase().includes(q)) ?? null;
}

// ---- Zone entity helpers ----

const SENSOR_TO_ZONE_FIELD: Record<SensorKey, keyof GardenZone['sensors']> = {
  soilMoisture: 'soilMoisture',
  temperature:  'temperature',
  humidity:     'humidity',
  lightLevel:   'lightLevel',
  pH:           'pH',
};

export function getSensorEntityId(zone: GardenZone, sensorKey: SensorKey): string | undefined {
  return zone.sensors[SENSOR_TO_ZONE_FIELD[sensorKey]];
}

type ActuatorField = keyof GardenZone['actuators'];

const COMMAND_TO_ACTUATOR_FIELD: Partial<Record<PermittedCommand, ActuatorField>> = {
  turn_on_water:   'waterValve',
  turn_off_water:  'waterValve',
  turn_on_light:   'growLight',
  turn_off_light:  'growLight',
  turn_on_fan:     'fan',
  turn_off_fan:    'fan',
  turn_on_heater:  'heater',
  turn_off_heater: 'heater',
};

export function getActuatorEntityId(zone: GardenZone, command: PermittedCommand): string | undefined {
  const field = COMMAND_TO_ACTUATOR_FIELD[command];
  return field !== undefined ? zone.actuators[field] : undefined;
}

// ---- Response formatters ----

const SENSOR_LABELS: Record<SensorKey, string> = {
  soilMoisture: 'soil moisture',
  temperature:  'temperature',
  humidity:     'humidity',
  lightLevel:   'light level',
  pH:           'pH',
};

export function formatSensorResponse(
  sensorKey: SensorKey,
  value: string,
  unit: string | undefined,
  zoneName: string,
): string {
  const val = unit ? `${value} ${unit}` : value;
  return `${zoneName} ${SENSOR_LABELS[sensorKey]} is ${val}.`;
}

const COMMAND_LABELS: Record<PermittedCommand, string> = {
  turn_on_water:   'Watering started',
  turn_off_water:  'Watering stopped',
  turn_on_light:   'Grow light on',
  turn_off_light:  'Grow light off',
  turn_on_fan:     'Fan on',
  turn_off_fan:    'Fan off',
  turn_on_heater:  'Heater on',
  turn_off_heater: 'Heater off',
  read_sensor:     'Reading sensor',
};

export function formatActuatorResponse(command: PermittedCommand, zoneName: string): string {
  return `${zoneName}: ${COMMAND_LABELS[command]}.`;
}
