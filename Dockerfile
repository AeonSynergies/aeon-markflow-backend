# syntax=docker/dockerfile:1

# Multi-stage build for the HTTP API server (src/server.ts) and the BullMQ worker
# (src/worker.ts) — same image, same build; which one runs is just the container command
# (default: the API server — see the runtime stage below). Node 20 to match the existing
# apprunner.yaml/apprunner-worker.yaml's `runtime: nodejs20` (see CLAUDE.md for why those
# two files are no longer the deployment path, but still describe the same Node version).

# ---- deps: production-only node_modules, copied into the runtime stage ----
FROM node:20-slim AS deps
WORKDIR /app
# bcrypt (native addon) installs from a prebuilt binary for almost every real deployment
# target, but python3/make/g++ are here as a fallback so `npm ci` never fails outright if no
# prebuilt binary matches this exact platform/libc. This stage is discarded after `deps` is
# copied out, so it doesn't add anything to the runtime image's size.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- build: full (dev+prod) deps, compiles TypeScript ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime: slim image with only what's needed to run the compiled output ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nodejs
USER nodejs

# Documentation only (EXPOSE doesn't publish anything) — the real port comes from PORT at
# runtime (src/config/env.ts), same convention as apprunner.yaml's run.network.port.
EXPOSE 8080

# Both the API server (src/app.ts) and the worker (src/worker.ts, via
# src/healthCheckServer.ts) serve GET /health, so this HEALTHCHECK works unmodified
# regardless of which CMD a given deployment actually runs.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

# Default: the HTTP API server. A worker deployment overrides this command to
# `node dist/worker.js` instead — same image, no separate build — mirroring the
# apprunner.yaml/apprunner-worker.yaml split this Dockerfile is meant to eventually replace.
CMD ["node", "dist/server.js"]
