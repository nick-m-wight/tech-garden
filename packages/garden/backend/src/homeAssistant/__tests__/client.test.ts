import crypto from 'node:crypto';
import {
  validateWebhookHmac,
  isValidEntityId,
  isPrivateHostname,
} from '../client';

// ---- validateWebhookHmac ----

describe('validateWebhookHmac', () => {
  const secret = 'test-webhook-secret-abc123';
  const body = Buffer.from('{"entity_id":"sensor.zone1_moisture","state":"42"}');

  function makeSignature(buf: Buffer, s: string): string {
    return `sha256=${crypto.createHmac('sha256', s).update(buf).digest('hex')}`;
  }

  it('accepts a correct signature', () => {
    expect(validateWebhookHmac(body, makeSignature(body, secret), secret)).toBe(true);
  });

  it('rejects a signature computed from a different body', () => {
    const otherBody = Buffer.from('tampered');
    expect(validateWebhookHmac(body, makeSignature(otherBody, secret), secret)).toBe(false);
  });

  it('rejects a signature computed with a different secret', () => {
    expect(validateWebhookHmac(body, makeSignature(body, 'wrong-secret'), secret)).toBe(false);
  });

  it('rejects a signature that is the wrong length', () => {
    expect(validateWebhookHmac(body, 'sha256=short', secret)).toBe(false);
  });

  it('accepts signature without the sha256= prefix (normalises it)', () => {
    const raw = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(validateWebhookHmac(body, raw, secret)).toBe(true);
  });

  it('rejects an all-zero signature of correct length', () => {
    const zeros = 'sha256=' + '0'.repeat(64);
    expect(validateWebhookHmac(body, zeros, secret)).toBe(false);
  });
});

// ---- isValidEntityId ----

describe('isValidEntityId', () => {
  it('accepts standard sensor entity IDs', () => {
    expect(isValidEntityId('sensor.zone1_soil_moisture')).toBe(true);
    expect(isValidEntityId('switch.zone2_water_valve')).toBe(true);
    expect(isValidEntityId('light.growlight_a')).toBe(true);
  });

  it('accepts single-character domain and entity parts', () => {
    expect(isValidEntityId('a.b')).toBe(true);
  });

  it('rejects IDs missing a dot', () => {
    expect(isValidEntityId('sensorzone1')).toBe(false);
  });

  it('rejects IDs with uppercase letters', () => {
    expect(isValidEntityId('Sensor.zone1')).toBe(false);
    expect(isValidEntityId('sensor.Zone1')).toBe(false);
  });

  it('rejects IDs with hyphens', () => {
    expect(isValidEntityId('sensor.zone-1')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEntityId('')).toBe(false);
  });

  it('rejects IDs starting with a digit', () => {
    expect(isValidEntityId('1sensor.zone1')).toBe(false);
    expect(isValidEntityId('sensor.1zone')).toBe(false);
  });

  it('rejects multiple dots', () => {
    expect(isValidEntityId('sensor.zone1.extra')).toBe(false);
  });
});

// ---- isPrivateHostname ----

describe('isPrivateHostname', () => {
  it('accepts localhost', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
  });

  it('accepts .local mDNS names', () => {
    expect(isPrivateHostname('homeassistant.local')).toBe(true);
    expect(isPrivateHostname('pi.local')).toBe(true);
  });

  it('accepts private IPv4 ranges', () => {
    expect(isPrivateHostname('10.0.0.1')).toBe(true);
    expect(isPrivateHostname('10.255.255.255')).toBe(true);
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('172.31.255.255')).toBe(true);
    expect(isPrivateHostname('192.168.1.100')).toBe(true);
    expect(isPrivateHostname('192.168.0.1')).toBe(true);
  });

  it('rejects public IPv4 addresses', () => {
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
    expect(isPrivateHostname('1.1.1.1')).toBe(false);
    expect(isPrivateHostname('172.15.0.1')).toBe(false);
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
  });

  it('rejects public domain names', () => {
    expect(isPrivateHostname('homeassistant.io')).toBe(false);
    expect(isPrivateHostname('example.com')).toBe(false);
    expect(isPrivateHostname('api.example.com')).toBe(false);
  });
});
