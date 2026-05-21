# Remote Access Options

The backend binds to `127.0.0.1` only and never listens on a public interface.
A tunnel or VPN layer sits in front of nginx and forwards traffic to it.

The mobile app reaches the backend over this tunnel (nginx on port 80/8080).

The MentraOS AppServer listens on port 7010 for **inbound HTTP webhooks** from
MentraOS Cloud. A separate tunnel must expose port 7010 publicly — MentraOS Cloud
calls your AppServer when a glasses session starts or stops.

---

## Quick Comparison

| Option | Cost | Port forwarding needed | Third-party dependency | Best for |
|---|---|---|---|---|
| Cloudflare Tunnel | Free | No | Cloudflare | Most users — Pi behind NAT |
| Tailscale | Free (≤3 devices) | No | Tailscale | Trusted-device mesh, WFH |
| WireGuard | Free (self-hosted) | Yes (UDP) | None | Full control, no SaaS |
| Local-only | — | No | None | Always on home WiFi |

**Recommendation for a home Pi:** Cloudflare Tunnel. Zero port-forwarding, automatic
HTTPS, free, and the phone reaches the backend from anywhere.

---

## Option A — Cloudflare Tunnel (recommended)

Cloudflare `cloudflared` creates an outbound-only tunnel from the Pi to Cloudflare's
edge. No port-forwarding, no public IP required, free HTTPS on your own domain.

### Two ports, two hostnames

This project needs **two** public endpoints:

| Hostname | Forwards to | Used by |
|---|---|---|
| `api.yourdomain.com` | `http://localhost:80` (nginx) | Mobile app, browser |
| `mentra.yourdomain.com` | `http://localhost:7010` | MentraOS Cloud (glasses sessions) |

Both run through a single tunnel. You choose the subdomains — they just need to be
on a domain whose DNS is managed by Cloudflare.

### Prerequisites

1. A free [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. A domain with its nameservers pointed at Cloudflare (or a domain registered at
   Cloudflare Registrar). This is a one-time DNS change at your current registrar.
3. The Pi is running and can reach the internet.

### Step 1 — Create the tunnel in the Cloudflare dashboard

1. Go to **Cloudflare dashboard → Zero Trust → Networks → Tunnels**.
2. Click **Create a tunnel** → choose **Cloudflared** → name it `tech-garden`.
3. Cloudflare shows you a **tunnel token** — copy it. You will put it in `.env.prod`.
4. Under **Public Hostnames**, add two entries:

   | Subdomain | Domain | Type | URL |
   |---|---|---|---|
   | `api` | `yourdomain.com` | HTTP | `localhost:80` |
   | `mentra` | `yourdomain.com` | HTTP | `localhost:7010` |

   Cloudflare creates the DNS records automatically.

5. Save. The tunnel shows as **Inactive** until `cloudflared` connects.

### Step 2 — Add cloudflared to docker-compose.prod.yml

The simplest approach is to run `cloudflared` as a container alongside the backend.
Add this service to `docker-compose.prod.yml`:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    network_mode: host          # lets cloudflared reach localhost:80 and localhost:7010
```

`network_mode: host` is important — it gives the container access to `localhost` on
the Pi, which is where nginx (port 80) and the AppServer (port 7010) listen.

### Step 3 — Update .env.prod

```env
# Cloudflare Tunnel
CLOUDFLARE_TUNNEL_TOKEN=eyJ...   # paste the token from the dashboard

# Mobile app API base URL
EXPO_PUBLIC_API_BASE_URL=https://api.yourdomain.com

# MentraOS AppServer public URL — register this in the MentraOS developer console
# so MentraOS Cloud knows where to send glasses session webhooks
MENTRA_PUBLIC_URL=https://mentra.yourdomain.com
```

### Step 4 — Register the AppServer URL with MentraOS

Log in to [console.mentra.glass](https://console.mentra.glass) and set your app's
**Webhook URL** to `https://mentra.yourdomain.com`. MentraOS Cloud will POST to
this address when a glasses session starts.

### Step 5 — Start everything

```bash
docker compose -f docker-compose.prod.yml up -d
```

The `cloudflared` container connects to Cloudflare's edge. The tunnel shows
**Active** in the dashboard within a few seconds. Both hostnames are now live.

### Verify

```bash
# API health check (should return {"status":"ok"})
curl https://api.yourdomain.com/health

# AppServer reachable (should return 404 or similar — it's not an HTTP API,
# but a 4xx from Cloudflare's edge means the tunnel is working)
curl -I https://mentra.yourdomain.com
```

### Alternative — run cloudflared as a systemd service (no Docker)

If you prefer to run `cloudflared` directly on the Pi OS instead of in Docker:

```bash
# Install cloudflared binary (Pi 4/5 = arm64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# Install as a systemd service using the tunnel token
cloudflared service install <TUNNEL_TOKEN>
systemctl enable --now cloudflared
```

The tunnel config (hostnames, routes) lives entirely in the Cloudflare dashboard —
no local config file needed with the token-based approach.

---

## Option B — Tailscale

Tailscale creates a WireGuard-based mesh VPN. Every device on the tailnet gets a
stable `100.x.x.x` IP. The phone must also be running the Tailscale app.

### Setup

```bash
# 1. Install Tailscale on the Pi
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. Note the Pi's Tailscale IP (shown in the Tailscale admin panel)
#    e.g. 100.64.0.5

# 3. Install Tailscale on your phone (iOS/Android app)
#    Sign in to the same account
```

No nginx config change needed. Traffic arrives at `100.64.0.5:80` (nginx) and is
forwarded to the backend.

### .env.prod change (or .env.local on mobile)

```
EXPO_PUBLIC_API_BASE_URL=http://100.64.0.5:80
```

Use `https` if you enable Tailscale's HTTPS certificates (`tailscale cert`).

### Tailscale HTTPS (optional)

```bash
sudo tailscale cert 100-64-0-5.tailnet-name.ts.net
# Copy the cert + key into infra/nginx/ and update nginx.prod.conf to terminate TLS
```

---

## Option C — WireGuard (self-hosted)

WireGuard runs entirely on your own infrastructure. Requires forwarding one UDP
port on your router to the Pi.

### Setup

```bash
# 1. Install WireGuard on the Pi
sudo apt install wireguard

# 2. Generate keys
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey

# 3. Create /etc/wireguard/wg0.conf on the Pi (server)
[Interface]
Address    = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <PI_PRIVATE_KEY>

[Peer]
# Phone client
PublicKey  = <PHONE_PUBLIC_KEY>
AllowedIPs = 10.8.0.2/32

# 4. Create the WireGuard config on your phone
#    (use the WireGuard mobile app to generate a key pair and import this config)
[Interface]
PrivateKey = <PHONE_PRIVATE_KEY>
Address    = 10.8.0.2/24
DNS        = 1.1.1.1

[Peer]
PublicKey  = <PI_PUBLIC_KEY>
Endpoint   = <YOUR_PUBLIC_IP>:51820   # router must forward UDP 51820 → Pi
AllowedIPs = 10.8.0.1/32             # only route Pi traffic through VPN

# 5. Enable WireGuard on the Pi
sudo systemctl enable --now wg-quick@wg0

# 6. Forward UDP port 51820 on your router to the Pi's LAN IP
```

### .env.prod change

```
EXPO_PUBLIC_API_BASE_URL=http://10.8.0.1:80
```

---

## Option D — Local-only (no remote access)

Use this when the phone is always on the same WiFi network as the Pi. No tunnel
or VPN needed.

Find the Pi's LAN IP:

```bash
hostname -I | awk '{print $1}'
# e.g. 192.168.1.42
```

### .env.prod change

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:80
```

The mobile app must be on the same LAN. Remote (cellular) access will not work.

---

## Security notes

- None of these options change the fact that the backend binds to `127.0.0.1` — it
  is never directly reachable without the tunnel or VPN.
- For Cloudflare Tunnel and Tailscale, TLS is handled by the tunnel provider.
- For WireGuard and local-only, traffic is unencrypted between the phone and nginx
  unless you add a TLS certificate to nginx (self-signed or Let's Encrypt via a
  local ACME client).
- The `CORS_ALLOWED_ORIGINS` env var in `.env.prod` should be set to the origin
  used by any browser client. Native mobile apps (Expo/iOS/Android) do not send
  `Origin` headers and are unaffected by CORS policy.
