# tech-garden

Smart-glasses home and garden assistant. Speak voice commands to read Home Assistant sensors, press the glasses button to photograph a plant and get an AI diagnosis, and see everything on a phone app.

---

## How the pieces fit together

```
Your phone  ──────────────►  nginx (port 8080)  ──►  Backend API (port 3000)
                                                         │
                                                         ├── SQLite database (local file)
                                                         └── Plant photo storage (local files)

Mentra Live glasses  ──►  MentraOS Cloud  ──►  ngrok tunnel  ──►  AppServer (port 7010)
```

**There are four moving parts:**

| Part | What it does | How it runs |
|---|---|---|
| **Backend + nginx** | API, database, photo storage | Docker on your PC/Pi |
| **Phone app** | View plant history, zone map, photos | Expo (React Native) on your phone |
| **AppServer** | Receives glasses events (voice, button, photo) | Inside Docker, port 7010 |
| **MentraOS Cloud** | Routes glasses traffic to your AppServer | Mentra's infrastructure — you don't run this |

**Why ngrok?**
The phone app talks directly to your PC over WiFi — no internet needed. But the glasses connect via MentraOS Cloud, which is on the internet and needs to send HTTP requests *to* your AppServer. Since your PC is behind a home router (no public IP), ngrok creates a tunnel so MentraOS Cloud can reach port 7010. ngrok is only needed for the glasses — remove it and the phone app still works fine.

**The database — do I need Supabase?**
No. The backend uses SQLite, which is just a file on disk (`data/dev/app-dev.db`). No account, no server, no setup. It works out of the box.

Supabase is an *optional* add-on if you want to sync plant history across multiple devices or access it from the cloud. Leave all `SUPABASE_*` variables blank to skip it entirely.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Node 20 LTS + npm
- [Expo Go](https://expo.dev/go) on your Android or iOS phone
- [ngrok account](https://ngrok.com) (free) — only needed for glasses

---

## One-time setup

### 1. Generate secrets

```bash
./infra/scripts/generate-secrets.sh
```

Creates `.env.dev` with JWT keys, app secret, and encryption key. Safe to re-run.

### 2. Fill in `.env.dev`

Open `.env.dev` and set:

| Variable | What it is | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Vision API key | [console.anthropic.com](https://console.anthropic.com) — set a spending cap |
| `HA_BASE_URL` | Home Assistant URL | e.g. `http://homeassistant.local:8123` |
| `HA_TOKEN` | HA long-lived access token | HA → Profile → Long-lived access tokens |
| `MENTRA_PACKAGE_NAME` | Your app's package name | [console.mentra.glass](https://console.mentra.glass) |
| `MENTRA_API_KEY` | Your app's API key | [console.mentra.glass](https://console.mentra.glass) |

Leave `SUPABASE_*` blank unless you want cloud sync.

### 3. Set the API URL for the phone app

Find your PC's local IP address:

```
ipconfig   # Windows — look for IPv4 Address under your WiFi adapter
```

Edit `packages/base/mobile/.env.development`:

```
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LAN_IP:8080
```

Example: `http://192.168.1.3:8080`

### 4. Install mobile dependencies

```bash
cd packages/base/mobile && npm install
```

### 5. Build and start Docker

```bash
docker compose -f docker-compose.dev.yml up --build
```

First run takes ~2 minutes to build the image. Wait until you see:

```
garden.server.listening  port=3000
garden.appserver.listening  port=7010
```

### 6. Create your user account

In a second terminal (keep Docker running):

```bash
docker compose -f docker-compose.dev.yml exec backend node dist/base/backend/src/scripts/createUser.js
```

Follow the prompts for email, role (`user`), and password. Use the same email you use for your Mentra account.

### 7. Verify the backend is up

```bash
curl -UseBasicParsing http://YOUR_LAN_IP:8080/health
# → {"status":"ok",...}
```

### 8. Set up ngrok for the glasses

Skip this step if you only want to use the phone app.

```bash
ngrok http --domain=YOUR_NGROK_DOMAIN 7010
```

Your ngrok domain is at [dashboard.ngrok.com](https://dashboard.ngrok.com). Keep this terminal open whenever you use the glasses.

In [console.mentra.glass](https://console.mentra.glass) → your app → Server Setup:

- Set **App Server URL** to `https://YOUR_NGROK_DOMAIN` (without `/webhook` — the console adds it automatically)

---

## Running the app (every time)

**Terminal 1 — backend:**
```bash
docker compose -f docker-compose.dev.yml up
```

**Terminal 2 — glasses tunnel** (skip if not using glasses):
```bash
ngrok http --domain=YOUR_NGROK_DOMAIN 7010
```

**Terminal 3 — phone app:**
```bash
cd packages/base/mobile && npx expo start
```

Scan the QR code with Expo Go on your phone.

---

## Using the glasses

1. Start all three terminals above
2. Open the MentraOS app on your phone, find **tech-garden**, and launch it on your glasses
3. The glasses display will show a green status page when connected
4. **Voice commands** — speak garden commands (requires Home Assistant configured)
5. **Photo** — press the glasses button once to photograph a plant; the result appears in the phone app under Plant History

---

## After changing backend code

**Most changes** — just recompile inside the running container (~10 sec):

```bash
docker compose -f docker-compose.dev.yml exec backend sh -c "npm run build && pkill node; node dist/garden/backend/src/app.js"
```

**Only use `--build`** when you change `package.json` or the `Dockerfile` (~2 min):

```bash
docker compose -f docker-compose.dev.yml up --build
```

---

## Production (Raspberry Pi)

```bash
docker compose -f docker-compose.prod.yml up -d
```

Set up a Cloudflare Tunnel instead of ngrok for both port 80 (phone) and port 7010 (glasses). See `infra/remote-access/OPTIONS.md`.

---

## Where things live

| Path | What's there |
|---|---|
| `CLAUDE.md` | Full architecture spec and security requirements |
| `packages/base/` | Reusable template — auth, AppServer scaffold, Expo app |
| `packages/garden/` | Garden app — HA integration, Claude Vision, photo storage |
| `infra/nginx/` | nginx configs |
| `infra/remote-access/OPTIONS.md` | Tunnel options (Cloudflare, Tailscale, WireGuard) |
| `infra/scripts/generate-secrets.sh` | One-time secret generation |
| `data/dev/` | SQLite database + encrypted photos (gitignored) |
| `keys/dev/` | JWT keypair (gitignored) |
| `docs/specs/` | Per-feature specs |

---

## Notes

- `.env.dev`, `.env.prod`, and `keys/` are gitignored — never committed
- The ngrok free domain is persistent; you don't need to update the Mentra console URL each session
- Home Assistant is optional — voice commands are silently ignored if not configured
- Claude Vision is optional — photos save and display without it; analysis is skipped
