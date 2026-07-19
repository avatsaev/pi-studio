# syntax=docker/dockerfile:1
#
# pi-studio-web-client — the production React/Vite browser UI (@av-pi-studio/web-client),
# served as a static SPA by nginx. Built from local monorepo source.
# Build context MUST be the repo root:  docker build -f docker/web-client.Dockerfile -t pi-studio-web-client .
#
# The daemon URL is entered at runtime in the toolbar (or via ?host=…), NOT baked at build time.
# Optionally set PI_STUDIO_DAEMON_UPSTREAM at container start to enable a same-origin /daemon-ws
# proxy (browser connects to ws://<web-host>/daemon-ws instead of the daemon port directly).

# ── Stage 1: build the static bundle ──────────────────────────────────────────
FROM node:22-bookworm AS build
WORKDIR /repo

# web-client bundles @av-pi-studio/protocol and @av-pi-studio/client from source (vite aliases +
# tsc -b project references), so install + copy those three packages.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol/package.json   packages/protocol/package.json
COPY packages/client/package.json     packages/client/package.json
COPY packages/relay/package.json      packages/relay/package.json
COPY packages/web-client/package.json packages/web-client/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @av-pi-studio/web-client --include-workspace-root

COPY packages/protocol   packages/protocol
COPY packages/relay       packages/relay
COPY packages/client     packages/client
COPY packages/web-client packages/web-client
RUN npm run build:web -w @av-pi-studio/web-client

# ── Stage 2: nginx static server ──────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Default upstream points at the compose `daemon` service; override at run time.
ENV PI_STUDIO_DAEMON_UPSTREAM=daemon:6767

COPY --from=build /repo/packages/web-client/dist/web /usr/share/nginx/html
COPY docker/web-client.nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

# Health: nginx serves the SPA entry.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
