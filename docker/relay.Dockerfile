# syntax=docker/dockerfile:1
#
# pi-studio-relay — standalone E2EE relay server (@av-pi-studio/relay).
#
# Pure-JS (tweetnacl + ws), stateless, zero native addons. Built from local monorepo source.
# Build context MUST be the repo root:  docker build -f docker/relay.Dockerfile -t pi-studio-relay .

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build
WORKDIR /repo

# Install the workspace deps needed to compile relay, then build just that package.
# (relay has no @av-pi-studio/* deps, but tsc -b + the root lockfile drive the install.)
COPY package.json package-lock.json ./
COPY packages/relay/package.json packages/relay/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @av-pi-studio/relay --include-workspace-root

COPY tsconfig.base.json tsconfig.base.json
COPY packages/relay packages/relay
RUN npm run build:relay

# Produce a minimal production node_modules containing only relay's runtime deps
# (ws + tweetnacl) — relay has no workspace deps to resolve. Installed standalone.
WORKDIR /repo/prod
RUN cp /repo/packages/relay/package.json ./package.json \
 && npm pkg delete devDependencies scripts bin \
 && npm install --omit=dev --no-package-lock --no-audit --no-fund

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /repo/prod/node_modules ./node_modules
COPY --from=build /repo/packages/relay/dist ./dist
COPY --from=build /repo/packages/relay/package.json ./package.json

ENV PI_STUDIO_RELAY_LISTEN=0.0.0.0:7000
EXPOSE 7000
USER node

# Health: the relay serves GET /health -> 200 "ok".
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PI_STUDIO_RELAY_LISTEN||'0.0.0.0:7000').split(':').pop()+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/relay-main.js"]
