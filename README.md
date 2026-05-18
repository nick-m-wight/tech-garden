# tech-garden

Smart-glasses home and garden control system. Reusable secure backend template (`packages/base/`) plus a Garden Expert app (`packages/garden/`) built on top. Authoritative spec: [`CLAUDE.md`](CLAUDE.md).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (backend)
- Node 20 LTS + npm (mobile)
- `openssl` and `bash` / git-bash (secret generation, one-time)

---

## One-time setup

### 1. Generate secrets

```bash
./infra/scripts/generate-secrets.sh
```

Creates `.env.dev` and `.env.prod` from `.env.example` (RS256 JWT keypair, app secret, photo encryption key, HA webhook secret). Idempotent — won't overwrite without `--force`.

### 2. Fill in the values the script can't generate

Edit `.env.dev`:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) — use a dev key with a spending cap |
| `HA_BASE_URL`, `HA_TOKEN` | Your Home Assistant URL + a long-lived access token |
| `MENTRA_PACKAGE_NAME`, `MENTRA_API_KEY` | [console.mentra.glass](https://console.mentra.glass) — optional; glasses features are disabled without them |
| `EXPO_PUBLIC_API_BASE_URL` | Your dev machine's LAN IP: `http://192.168.1.XX:8080` (find it with `ipconfig`) |
| `SUPABASE_*` | Only needed if opting into cloud sync |

### 3. Install mobile deps

```bash
cd packages/base/mobile && npm install
```

### 4. Create a user account

```bash
cd packages/garden/backend && npm install && npm run create-user
```

Interactive prompt for email, role, and password. The app won't let you log in without this.

---

## Running the app

Two terminals:

**Terminal 1 — backend + nginx**

```bash
docker compose -f docker-compose.dev.yml up
```

First run builds the Docker image (~2 min). Backend on `:3001`, nginx on `:8080`. Re-run after changing source:

```bash
docker compose -f docker-compose.dev.yml exec backend sh -c "npm run build && pkill node; node dist/garden/backend/src/app.js"
```

Or just `docker compose -f docker-compose.dev.yml up --build` to rebuild the image.

**Terminal 2 — mobile**

```bash
cd packages/base/mobile && npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on your phone, or press `a` for an Android emulator.

**Verify the backend is up:**

```bash
curl http://127.0.0.1:8080/health
# → { "status": "ok", ... }
```

---

## Remote access (phone off local WiFi)

No ngrok needed. The backend already binds to `127.0.0.1` only; a tunnel layer sits in front of nginx. See [`infra/remote-access/OPTIONS.md`](infra/remote-access/OPTIONS.md) for setup guides:

- **Cloudflare Tunnel** (recommended) — zero port-forwarding, automatic HTTPS, free
- Tailscale — WireGuard mesh, phone must run the Tailscale app
- WireGuard self-hosted — requires forwarding one UDP port on your router
- Local-only — phone must be on the same WiFi as the Pi

---

## Where things live

| Path | What's there |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Source of truth: architecture, security controls, full build spec |
| `packages/base/` | Reusable secure template — JWT auth, MentraOS AppServer, Expo scaffold |
| `packages/garden/` | Garden Expert app — HA integration, Claude Vision plant analysis, annotated photo display |
| `infra/nginx/` | nginx configs for dev (`:8080`) and prod (`:80`) |
| `infra/remote-access/OPTIONS.md` | Tunnel/VPN options for reaching the backend from outside LAN |
| `infra/scripts/generate-secrets.sh` | One-shot secret generation |
| `docs/threat-model.md` | Threat model |
| `docs/specs/` | Per-feature specs (AI config, HA client, photo storage, mobile UI, etc.) |

---

## Production (Raspberry Pi)

```bash
# On the Pi
docker compose -f docker-compose.prod.yml up -d
```

Backend and nginx both bind to `127.0.0.1`; configure a Cloudflare Tunnel or Tailscale in front. See `infra/remote-access/OPTIONS.md`.

---

## Notes

- `.env.dev` / `.env.prod` and `keys/` are `.gitignore`d. Each developer generates their own via `generate-secrets.sh`.
- `chmod 0600` doesn't enforce on NTFS. The generated key files only get effective restrictive permissions on Linux/macOS (i.e., the Pi in prod).
- The MentraOS AppServer connects **outbound** to MentraOS cloud — no inbound port required for glasses traffic.
