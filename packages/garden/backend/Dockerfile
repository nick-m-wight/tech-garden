# syntax=docker/dockerfile:1
# Build context: repo root (.)
# Required because TypeScript compilation includes packages/base/backend/src (rootDir = packages/).

# ---- prod deps (native build tools included for better-sqlite3) ----
FROM node:20-alpine AS deps
RUN apk add --no-cache build-base python3
WORKDIR /app/packages/garden/backend
COPY packages/garden/backend/package.json packages/garden/backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- all deps (devDependencies needed for tsc) ----
FROM deps AS dev-deps
RUN npm ci

# ---- development ----
FROM node:20-alpine AS development
WORKDIR /app
COPY --from=dev-deps /app/packages/garden/backend/node_modules packages/garden/backend/node_modules
COPY packages/base/backend/src packages/base/backend/src
COPY packages/garden/backend packages/garden/backend
RUN mkdir -p packages/garden/backend/dist \
    && chown -R node:node packages/garden/backend
WORKDIR /app/packages/garden/backend
USER node
# Build TypeScript then start. Source is volume-mounted; run docker exec npm run build to hot-rebuild.
CMD ["sh", "-c", "npm run build && node dist/garden/backend/src/app.js"]

# ---- build ----
FROM dev-deps AS build
WORKDIR /app
COPY packages/base/backend/src packages/base/backend/src
COPY packages/garden/backend packages/garden/backend
WORKDIR /app/packages/garden/backend
RUN npm run build

# ---- production ----
FROM node:20-alpine AS production
WORKDIR /app/packages/garden/backend
COPY --from=deps /app/packages/garden/backend/node_modules ./node_modules
COPY --from=build /app/packages/garden/backend/dist ./dist
COPY packages/garden/backend/package.json ./
RUN chown -R node:node .
USER node
CMD ["node", "dist/garden/backend/src/app.js"]
