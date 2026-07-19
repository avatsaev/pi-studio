# syntax=docker/dockerfile:1
#
# pi-studio-daemon — the production Pi-Studio daemon (@av-pi-studio/server).
#
# Fat image: compiles the native `node-pty` addon, ships `git` (worktrees/projects) and the
# bundled `pi` runtime (@earendil-works/pi-coding-agent). Built from local monorepo source.
# Build context MUST be the repo root:  docker build -f docker/daemon.Dockerfile -t pi-studio-daemon .
#
# Optional GitHub CLI (gh) for GitHub checkout/auto-merge features:
#   docker build -f docker/daemon.Dockerfile --build-arg INSTALL_GH=true -t pi-studio-daemon .

# ── Stage 1: build (toolchain + native compile) ───────────────────────────────
FROM node:22-bookworm AS build
WORKDIR /repo

# node-pty compiles a native addon → needs python3 + make + a C++ compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Copy every workspace package.json so `npm ci` can resolve the full workspace graph.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol/package.json  packages/protocol/package.json
COPY packages/highlight/package.json packages/highlight/package.json
COPY packages/relay/package.json     packages/relay/package.json
COPY packages/client/package.json    packages/client/package.json
COPY packages/server/package.json    packages/server/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @av-pi-studio/server --include-workspace-root

# Build the server's dependency chain: protocol → highlight → relay → client → server.
COPY packages/protocol  packages/protocol
COPY packages/highlight packages/highlight
COPY packages/relay     packages/relay
COPY packages/client    packages/client
COPY packages/server    packages/server
RUN npm run build:protocol \
 && npm run build:highlight \
 && npm run build:relay \
 && npm run build:client \
 && npm run build:server

# Drop dev dependencies from node_modules (keeps the compiled node-pty addon).
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev --workspace @av-pi-studio/server --include-workspace-root

# ── Stage 2: runtime (slim + git, no compilers) ───────────────────────────────
FROM node:22-bookworm-slim AS runtime
ARG INSTALL_GH=false
ENV NODE_ENV=production

# git: required for project/worktree operations and remote checkout.
# gh: optional GitHub CLI, only when INSTALL_GH=true.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates \
    && if [ "$INSTALL_GH" = "true" ]; then \
         apt-get install -y --no-install-recommends curl \
         && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
         && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
         && apt-get update && apt-get install -y --no-install-recommends gh ; \
       fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Copy the built workspace: node_modules (with compiled node-pty + workspace symlinks),
# every package's dist, and the package.json manifests that back the symlinks.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/protocol/package.json  ./packages/protocol/package.json
COPY --from=build /repo/packages/protocol/dist          ./packages/protocol/dist
COPY --from=build /repo/packages/highlight/package.json ./packages/highlight/package.json
COPY --from=build /repo/packages/highlight/dist         ./packages/highlight/dist
COPY --from=build /repo/packages/relay/package.json     ./packages/relay/package.json
COPY --from=build /repo/packages/relay/dist             ./packages/relay/dist
COPY --from=build /repo/packages/client/package.json    ./packages/client/package.json
COPY --from=build /repo/packages/client/dist            ./packages/client/dist
COPY --from=build /repo/packages/server/package.json    ./packages/server/package.json
COPY --from=build /repo/packages/server/dist            ./packages/server/dist

# Persistent state (agents, keypair, logs, registries) lives here — mount a volume.
ENV PI_STUDIO_HOME=/data
ENV PI_STUDIO_LISTEN=0.0.0.0:6767
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

EXPOSE 6767
USER node

# Health: the daemon serves GET /api/health -> {"status":"ok"} (exempt from host/auth checks).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PI_STUDIO_LISTEN||'0.0.0.0:6767').split(':').pop()+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "packages/server/dist/daemon/main.js"]
