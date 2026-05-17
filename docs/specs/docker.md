# Docker Setup

## docker-compose.dev.yml
```yaml
services:
  backend:
    build:
      context: ./packages/garden/backend
      target: development
    ports: ["3001:3001"]
    env_file: .env.dev
    volumes:
      - ./packages/garden/backend/src:/app/src   # hot reload
      - ./data/dev:/app/data
    user: "node"                                  # non-root (OWASP A05)

  nginx:
    image: nginx:alpine
    ports: ["8080:80"]
    volumes:
      - ./infra/nginx/nginx.dev.conf:/etc/nginx/nginx.conf
```

## docker-compose.prod.yml
```yaml
services:
  backend:
    build:
      context: ./packages/garden/backend
      target: production
    # Backend binds to localhost only — never expose directly to internet.
    # Remote access handled by tunnel layer (see infra/remote-access/OPTIONS.md).
    ports: ["127.0.0.1:3000:3000"]
    env_file: .env.prod
    volumes:
      - ./data/prod:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    user: "node"

  nginx:
    image: nginx:alpine
    # nginx terminates internal TLS between containers. Does NOT bind to a public port.
    ports: ["127.0.0.1:80:80"]
    volumes:
      - ./infra/nginx/nginx.prod.conf:/etc/nginx/nginx.conf
    restart: unless-stopped
    depends_on:
      - backend
```

## Remote access — deferred decision
See `infra/remote-access/OPTIONS.md`. Options: Cloudflare Tunnel, Tailscale, WireGuard, local-only.
