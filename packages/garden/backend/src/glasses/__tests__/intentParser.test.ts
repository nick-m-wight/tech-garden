import {
  parseGardenIntent,
  parseRepeatIntent,
  stripWakeWord,
  extractZoneQuery,
  findZone,
  getSensorEntityId,
  getActuatorEntityId,
  formatSensorResponse,
  formatActuatorResponse,
} from '../intentParser';
import type { GardenZone } from '../../homeAssistant/zones';

// ---- Fixture ----

function makeZone(overrides: Partial<GardenZone> = {}): GardenZone {
  return {
    id: 'zone-uuid-1',
    userId: 'user-uuid',
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
    ...overrides,
  };
}

const ZONES: GardenZone[] = [
  makeZone(),
  makeZone({ id: 'zone-uuid-2', name: 'Raised Bed', sensors: { soilMoisture: undefined, temperature: undefined, humidity: undefined, lightLevel: undefined, pH: undefined, npk: undefined, rain: undefined }, actuators: { waterValve: undefined, growLight: 'light.raised_bed', fan: undefined, heater: undefined } }),
  makeZone({ id: 'zone-uuid-3', name: 'Zone 3', sensors: { soilMoisture: undefined, temperature: undefined, humidity: undefined, lightLevel: undefined, pH: undefined, npk: undefined, rain: undefined }, actuators: { waterValve: undefined, growLight: undefined, fan: undefined, heater: undefined } }),
];

// ---- stripWakeWord ----

describe('stripWakeWord', () => {
  it('matches "hey garden" and strips the prefix', () => {
    expect(stripWakeWord('hey garden check moisture in zone 1')).toBe('check moisture in zone 1');
  });

  it('matches "ok garden" with a comma', () => {
    expect(stripWakeWord('ok garden, check moisture in zone 1')).toBe('check moisture in zone 1');
  });

  it('matches "okay garden"', () => {
    expect(stripWakeWord('okay garden turn on water in zone 2')).toBe('turn on water in zone 2');
  });

  it('matches "hi garden"', () => {
    expect(stripWakeWord('hi garden whats the temp in zone 3')).toBe('whats the temp in zone 3');
  });

  it('matches bare "garden" at the start', () => {
    expect(stripWakeWord('garden, check moisture in zone 1')).toBe('check moisture in zone 1');
  });

  it('is case-insensitive', () => {
    expect(stripWakeWord('Hey Garden check moisture in zone 1')).toBe('check moisture in zone 1');
  });

  it('returns null when wake word is missing', () => {
    expect(stripWakeWord('check moisture in zone 1')).toBeNull();
  });

  it("returns null when 'garden' appears mid-sentence", () => {
    // Sensor responses must not re-trigger via wake-word match.
    expect(stripWakeWord("Sorry, I didn't understand that garden command")).toBeNull();
  });

  it("doesn't match 'gardener' or 'gardens'", () => {
    expect(stripWakeWord('hey gardener check moisture')).toBeNull();
    expect(stripWakeWord('hey gardens check moisture')).toBeNull();
  });

  it('returns empty string when wake word is the entire utterance', () => {
    expect(stripWakeWord('hey garden')).toBe('');
    expect(stripWakeWord('garden')).toBe('');
  });
});

// ---- parseRepeatIntent ----

describe('parseRepeatIntent', () => {
  it('detects "repeat that"', () => {
    expect(parseRepeatIntent('repeat that')).toBe(true);
  });

  it('detects "say that again"', () => {
    expect(parseRepeatIntent('say that again')).toBe(true);
  });

  it('detects "again"', () => {
    expect(parseRepeatIntent('again')).toBe(true);
  });

  it('returns false for unrelated commands', () => {
    expect(parseRepeatIntent('check moisture in zone 1')).toBe(false);
  });
});

// ---- extractZoneQuery ----

describe('extractZoneQuery', () => {
  it('extracts numeric zone', () => {
    expect(extractZoneQuery('check the moisture in zone 1')).toBe('1');
  });

  it('converts spoken number to digit', () => {
    expect(extractZoneQuery('check temp in zone two')).toBe('2');
  });

  it('extracts zone name', () => {
    expect(extractZoneQuery('what is the temperature in the raised bed')).toBe('raised bed');
  });

  it('returns null when no zone mentioned', () => {
    expect(extractZoneQuery('what is the temperature')).toBeNull();
  });

  it('handles terminal punctuation added by speech-to-text', () => {
    expect(extractZoneQuery('check moisture in zone 1.')).toBe('1');
    expect(extractZoneQuery('check moisture in zone 1!')).toBe('1');
  });

  it('handles "for zone" phrasing', () => {
    expect(extractZoneQuery('check moisture for zone 3')).toBe('3');
  });
});

// ---- parseGardenIntent ----

describe('parseGardenIntent', () => {
  it('returns null when no zone is mentioned', () => {
    expect(parseGardenIntent('check the soil moisture')).toBeNull();
  });

  it('parses sensor_read: moisture', () => {
    const intent = parseGardenIntent('check the soil moisture in zone 1');
    expect(intent).toEqual({ action: 'sensor_read', sensorKey: 'soilMoisture', zoneQuery: '1' });
  });

  it('parses sensor_read: temperature', () => {
    const intent = parseGardenIntent('what is the temperature in zone 2');
    expect(intent?.action).toBe('sensor_read');
    if (intent?.action === 'sensor_read') expect(intent.sensorKey).toBe('temperature');
  });

  it('parses sensor_read: humidity', () => {
    const intent = parseGardenIntent('how is the humidity in zone 1');
    expect(intent?.action).toBe('sensor_read');
    if (intent?.action === 'sensor_read') expect(intent.sensorKey).toBe('humidity');
  });

  it('parses sensor_read: pH', () => {
    const intent = parseGardenIntent("what's the pH in zone 3");
    expect(intent?.action).toBe('sensor_read');
    if (intent?.action === 'sensor_read') expect(intent.sensorKey).toBe('pH');
  });

  it('parses actuator: turn on water', () => {
    const intent = parseGardenIntent('turn on the watering in zone 1');
    expect(intent).toEqual({ action: 'actuator', command: 'turn_on_water', zoneQuery: '1' });
  });

  it('parses actuator: turn off water', () => {
    const intent = parseGardenIntent('turn off the water in zone 2');
    expect(intent).toEqual({ action: 'actuator', command: 'turn_off_water', zoneQuery: '2' });
  });

  it('parses actuator: grow light', () => {
    const intent = parseGardenIntent('turn on the lights in zone 1');
    if (intent?.action === 'actuator') expect(intent.command).toBe('turn_on_light');
    else fail('expected actuator intent');
  });

  it('parses actuator: fan', () => {
    const intent = parseGardenIntent('start the fan in zone 3');
    if (intent?.action === 'actuator') expect(intent.command).toBe('turn_on_fan');
    else fail('expected actuator intent');
  });

  it('returns null for ambiguous turn on/off', () => {
    // Both "turn on" and "turn off" present — ambiguous.
    expect(parseGardenIntent('turn on and turn off the water in zone 1')).toBeNull();
  });

  it('prefers actuator over sensor read for device words', () => {
    const intent = parseGardenIntent('turn on the water in zone 1');
    expect(intent?.action).toBe('actuator');
  });
});

// ---- findZone ----

describe('findZone', () => {
  it('matches exact name (case-insensitive)', () => {
    expect(findZone(ZONES, 'raised bed')?.name).toBe('Raised Bed');
  });

  it('matches by numeric string (exact index)', () => {
    expect(findZone(ZONES, '1')?.name).toBe('Zone 1');
    expect(findZone(ZONES, '3')?.name).toBe('Zone 3');
  });

  it('matches by substring', () => {
    expect(findZone(ZONES, 'raised')?.name).toBe('Raised Bed');
  });

  it('returns null for no match', () => {
    expect(findZone(ZONES, 'greenhouse')).toBeNull();
  });

  it('returns null for index out of range', () => {
    expect(findZone(ZONES, '99')).toBeNull();
  });
});

// ---- getSensorEntityId / getActuatorEntityId ----

describe('getSensorEntityId', () => {
  const zone = makeZone();

  it('returns configured entity', () => {
    expect(getSensorEntityId(zone, 'soilMoisture')).toBe('sensor.zone1_moisture');
  });

  it('returns undefined for unconfigured sensor', () => {
    expect(getSensorEntityId(zone, 'humidity')).toBeUndefined();
  });
});

describe('getActuatorEntityId', () => {
  const zone = makeZone();

  it('returns configured actuator entity', () => {
    expect(getActuatorEntityId(zone, 'turn_on_water')).toBe('switch.zone1_water');
    expect(getActuatorEntityId(zone, 'turn_off_water')).toBe('switch.zone1_water');
  });

  it('returns undefined for unconfigured actuator', () => {
    expect(getActuatorEntityId(zone, 'turn_on_light')).toBeUndefined();
  });

  it('returns undefined for read_sensor command', () => {
    expect(getActuatorEntityId(zone, 'read_sensor')).toBeUndefined();
  });
});

// ---- formatSensorResponse / formatActuatorResponse ----

describe('formatSensorResponse', () => {
  it('includes zone name, sensor type, value and unit', () => {
    const msg = formatSensorResponse('soilMoisture', '42', '%', 'Zone 1');
    expect(msg).toContain('Zone 1');
    expect(msg).toContain('soil moisture');
    expect(msg).toContain('42 %');
  });

  it('omits unit when undefined', () => {
    const msg = formatSensorResponse('pH', '6.8', undefined, 'Raised Bed');
    expect(msg).toContain('6.8');
    expect(msg).not.toContain('undefined');
  });
});

describe('formatActuatorResponse', () => {
  it('includes zone name and action label', () => {
    expect(formatActuatorResponse('turn_on_water', 'Zone 1')).toContain('Watering started');
    expect(formatActuatorResponse('turn_off_light', 'Zone 2')).toContain('Grow light off');
  });
});
