# Remote Access Options

The backend binds to `127.0.0.1` only and never listens on a public interface.
A tunnel or VPN layer sits in front of nginx and forwards traffic to it.

The mobile app reaches the backend over this tunnel. The MentraOS AppServer makes
an **outbound** WebSocket connection to MentraOS cloud (no inbound port required for
glasses traffic).

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

Cloudflare `cloudflared` creates an outbound tunnel from the Pi to Cloudflare's
edge. Traffic arrives at a stable HTTPS URL without any router changes.

### Setup

```bash
# 1. Install cloudflared on the Pi
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# 2. Authenticate (opens a browser — run on a machine with a browser, then copy cert)
cloudflared tunnel login

# 3. Create a named tunnel
cloudflared tunnel create tech-garden

# 4. Route a hostname to the tunnel
#    (requires a domain managed by Cloudflare DNS)
cloudflared tunnel route dns tech-garden api.yourdomain.com

# 5. Create config
cat > /etc/cloudflared/config.yml <<EOF
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:80       # nginx
  - service: http_status:404
EOF

# 6. Install and start as a systemd service
cloudflared service install
systemctl enable --now cloudflared
```

### .env.prod change

```
# Mobile app points here
EXPO_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

### docker-compose addition (optional — run cloudflared in Docker instead)

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    depends_on:
      - nginx
```

Add `CLOUDFLARE_TUNNEL_TOKEN=` to `.env.prod` (get from Cloudflare dashboard).

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
