# Home Assistant Integration

## Client design (`garden/backend/src/homeAssistant/client.ts`)
- Base URL and token loaded from env only. Never from client input (OWASP A10).
- All entity IDs validated against a user-specific whitelist stored in DB (OWASP A01).
- Request timeout: 5 seconds. Retry: 2 attempts with exponential backoff.
- Every HA call audit logged with userId, entity, action, result (OWASP A09).

## Zone model

```typescript
interface GardenZone {
  id: string;           // UUID
  userId: string;       // owner
  name: string;         // "Zone 1 — Raised Bed"
  sensors: {
    soilMoisture?: string;    // HA entity_id
    temperature?: string;
    humidity?: string;
    lightLevel?: string;
    pH?: string;
    npk?: string;
    rain?: string;
  };
  actuators: {
    waterValve?: string;      // HA entity_id
    growLight?: string;
    fan?: string;
    heater?: string;
  };
}
```

## Permitted commands (whitelist — expand carefully)

```typescript
const PERMITTED_COMMANDS = [
  'turn_on_water',
  'turn_off_water',
  'turn_on_light',
  'turn_off_light',
  'turn_on_fan',
  'turn_off_fan',
  'turn_on_heater',
  'turn_off_heater',
  'read_sensor',
] as const;
```

## Webhook validation
- All HA webhook payloads validated with zod + HMAC signature check (OWASP A08).
- `HA_WEBHOOK_SECRET` from env only — never hardcoded.
