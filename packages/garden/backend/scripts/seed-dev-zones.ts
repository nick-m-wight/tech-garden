// Dev-only seed: creates 3 garden zones tied to a real user, each wired to one
// HA soil-moisture sensor (sensor.plant_monitor_soil_moisture_{1,2,3}).
//
// Usage (from packages/garden/backend):
//   npm run seed:zones -- --email nick.m.wight@gmail.com
//
// Refuses to run unless NODE_ENV === 'development' (CLAUDE.md §5).
// Idempotent: if zones named "1"/"2"/"3" already exist for the user, they are
// replaced.

import path from 'node:path';
// Resolve relative paths in .env.dev (DB_PATH, JWT key paths, etc.) from repo root.
process.chdir(path.resolve(__dirname, '../../../..'));

import crypto from 'node:crypto';
import { getGardenDb } from '../src/db/connection';
import { createZone, deleteZone, getZonesByUserId, GardenZoneSchema } from '../src/homeAssistant/zones';

if (process.env.NODE_ENV !== 'development') {
  console.error(`Refusing to seed: NODE_ENV is '${process.env.NODE_ENV ?? ''}', expected 'development'.`);
  process.exit(1);
}

function getArg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

const email = getArg('email') ?? process.argv.slice(2).find((a) => !a.startsWith('-') && a.includes('@'));
if (!email) {
  console.error('Missing email. Usage: npm run seed:zones -- nick@example.com');
  process.exit(1);
}

const db = getGardenDb();

interface UserRow { id: string; email: string }
const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as UserRow | undefined;

if (!user) {
  const allUsers = db.prepare('SELECT email FROM users').all() as Array<{ email: string }>;
  console.error(`No user with email '${email}'. Known users:`);
  for (const u of allUsers) console.error(`  - ${u.email}`);
  if (allUsers.length === 0) console.error('  (none — register/login via the mobile app first)');
  process.exit(1);
}

const SENSOR_PREFIX = 'sensor.plant_monitor_soil_moisture_';
const ZONE_NAMES = ['1', '2', '3'] as const;

const existing = getZonesByUserId(db, user.id);
let removed = 0;
for (const z of existing) {
  if ((ZONE_NAMES as readonly string[]).includes(z.name)) {
    deleteZone(db, z.id, user.id);
    removed++;
  }
}

const created: Array<{ name: string; sensor: string }> = [];
for (const name of ZONE_NAMES) {
  const zone = GardenZoneSchema.parse({
    id: crypto.randomUUID(),
    userId: user.id,
    name,
    sensors: { soilMoisture: `${SENSOR_PREFIX}${name}` },
    actuators: {},
  });
  createZone(db, zone);
  created.push({ name, sensor: zone.sensors.soilMoisture as string });
}

console.log(`Seeded zones for ${user.email} (${user.id}):`);
if (removed > 0) console.log(`  replaced ${removed} existing zone(s) with the same name`);
for (const z of created) console.log(`  zone "${z.name}" → ${z.sensor}`);
console.log('\nTry: "check moisture in zone 1"  (or "in zone one")');
