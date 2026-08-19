# Running Pi-Studio in Docker

Three images, all built from local monorepo source:

| Image | Package | Base | Contents |
|---|---|---|---|
| `pi-studio-daemon` | `@av-pi-studio/server` | `node:22-bookworm-slim` | daemon + compiled `node-pty` + `git` + bundled `pi` runtime |
| `pi-studio-relay` | `@av-pi-studio/relay` | `node:22-bookworm-slim` | standalone E2EE relay (pure JS, no native, stateless) |
| `pi-studio-web-client` | `@av-pi-studio/web-client` | `nginx:1.27-alpine` | static React/Vite SPA + optional same-origin `/daemon-ws` proxy |

All three build from local monorepo source. The daemon and relay bind `0.0.0.0`, are driven by
environment variables, and shut down cleanly on `SIGTERM`; the web UI is a static bundle served by
nginx. No source changes are needed to containerize them.

## Quick start (compose — daemon + relay + web UI)

```bash
cd docker
docker compose up --build
```

This starts the relay (`:7000`), the daemon (`:6767`), and the web UI (`:8080`), with the daemon
dialing **outbound** to the relay so the full `client → relay → daemon` topology runs locally. Then:

```bash
# open the web UI, then type the daemon URL (http://localhost:6767) in the toolbar and Connect
open http://localhost:8080
# ...or drive it from the CLI, direct to the daemon
pi-studio --host http://localhost:6767 ls
# health probes
curl http://localhost:6767/api/health   # → {"status":"ok"}
curl http://localhost:7000/health        # → ok
curl http://localhost:8080/ -I           # → 200 (SPA)
```

> The web UI reads the daemon URL at **runtime** from the toolbar (or `?host=&connect=1` query
> params) — it is never baked into the image. In compose you can instead point the toolbar host at
> `ws://localhost:8080/daemon-ws`, the same-origin proxy nginx forwards to the daemon service.

Compose knobs (env vars, all optional):

| Var | Default | Effect |
|---|---|---|
| `PI_STUDIO_DAEMON_PORT` | `6767` | Host port mapped to the daemon |
| `PI_STUDIO_RELAY_PORT` | `7000` | Host port mapped to the relay |
| `PI_STUDIO_WEB_PORT` | `8080` | Host port mapped to the web UI |
| `PI_STUDIO_PASSWORD` | _(unset)_ | Bcrypt-checked connection password |
| `PI_STUDIO_INSTALL_GH` | `false` | Bundle the GitHub CLI (`gh`) into the daemon image |
| `ANTHROPIC_API_KEY` | _(unset)_ | pi provider credential (see [pi auth](#pi-provider-auth)) |

## Building the images individually

```bash
# from the repo root (build context MUST be the root — workspace deps resolve there)
docker build -f docker/relay.Dockerfile  -t pi-studio-relay  .
docker build -f docker/daemon.Dockerfile -t pi-studio-daemon .
docker build -f docker/web-client.Dockerfile -t pi-studio-web-client .

# daemon with the GitHub CLI included:
docker build -f docker/daemon.Dockerfile --build-arg INSTALL_GH=true -t pi-studio-daemon .
```

> **`npm ci`'s cache mount is per-image and locked, deliberately.** Each Dockerfile's
> `--mount=type=cache,target=/root/.npm` carries its own `id=` (`npm-relay`/`npm-daemon`/
> `npm-web-client`) and `sharing=locked`. Without an explicit `id`, BuildKit derives it from the
> mount's `target` path — identical (`/root/.npm`) across all three Dockerfiles — so they were
> silently sharing one cache store under the default `sharing=shared` mode. Real incident
> (2026-08-19): `docker:publish`'s sequential `relay` → `daemon` → `web-client` builds hit that
> shared, unlocked cache back-to-back — `web-client`'s `npm ci` started against the same cache
> milliseconds after `daemon`'s last `npm prune` step named its image, and its `esbuild`
> postinstall exec raced BuildKit's still-settling cache-mount teardown from the daemon build:
> `spawnSync .../esbuild/bin/esbuild ETXTBSY` (moby/buildkit#1818 is the same class of bug).
> `sharing=locked` makes BuildKit take an exclusive lock per mount instead of racing; the distinct
> `id`s mean the three images no longer contend for the same store at all. If this resurfaces, the
> fix is here, not in the npm/esbuild versions.

> **Full release pipeline**: `npm run release` (`scripts/release.sh`) chains npm publish + this
> Docker build/push + the Dokploy deploy below into one command, tagged consistently end-to-end.
> See root `AGENTS.md` § Release & production deployment. The sections below cover each script
> individually — useful when you only need one step (e.g. re-pushing images without redeploying).

## Building + pushing to Docker Hub

`scripts/docker-publish.sh` (`npm run docker:publish`) builds all three images from local source,
boot-smoke-tests `pi-studio-web-client` (runs it detached, curls for a 200) before pushing
anything, then tags and pushes each to its Docker Hub repo under the `avatsaev` namespace:
`avatsaev/pi-studio-relay`, `avatsaev/pi-studio-daemon`, `avatsaev/pi-studio-web-client`.

```bash
npm run docker:publish                    # build + smoke-test + push :latest
npm run docker:publish -- --tag 0.0.12    # also tag + push :0.0.12 alongside :latest
npm run docker:publish -- --dry-run       # build + smoke-test, skip the push
npm run docker:publish -- --no-build      # push existing local images as-is
npm run docker:publish -- --install-gh    # bundle the GitHub CLI into the daemon image
```

Requires `docker login` with push access to those repos first.

## Deploying to production (Dokploy)

`scripts/dokploy-deploy.sh` (`npm run docker:deploy`) deploys the `relay` and `web-client`
compose stacks on the production Dokploy instance (project `molagent-platform`, relay at
`relay.molagent.ai`, web UI at `app.molagent.ai`). It does NOT build/push images itself — run
`npm run docker:deploy` after, or as a separate step from, `docker:publish`. The daemon is
intentionally NOT part of this script: it isn't deployed to `molagent-platform` today (only the
relay + web UI are; the daemon runs locally / self-hosted per user).

**Pins each stack's image to a concrete version tag** (default: the repo's current
`packages/protocol/package.json` version) rather than deploying against a bare/`:latest`
reference. This is load-bearing, not cosmetic: Dokploy's deploy command is
`docker compose up -d --build --remove-orphans` — it never runs `docker compose pull`, and there
is no exposed API/CLI endpoint to force one. Against a bare `image: avatsaev/pi-studio-web-client`
(implicit `:latest`) already cached on the Dokploy host, `up -d` sees nothing changed and leaves
the stale container running while the deployment record still reports "done" — a real incident
(2026-07-22: `app.molagent.ai` stayed on a two-day-old build after multiple "successful"
redeploys, confirmed by comparing bundle hashes/container `Created` timestamps against Docker
Hub's actual `:latest` digest). Rewriting the compose file's `image:` line to a fresh tag on every
deploy forces Dokploy to detect a real diff and recreate the container, which DOES pull.

```bash
npm run docker:deploy                    # pin+deploy both to the repo's current version
npm run docker:deploy -- relay           # relay only
npm run docker:deploy -- web-client      # web-client only
npm run docker:deploy -- --tag 0.0.12    # pin to a specific version (e.g. a hotfix rollback)
npm run docker:deploy -- --no-wait       # trigger, don't poll for completion
```

Requires the pinned version tag to already exist on Docker Hub — run
`npm run docker:publish -- --tag <version>` FIRST if it doesn't.

Requires the [`dokploy` CLI](https://github.com/Dokploy/cli) installed and authenticated
(`dokploy auth`). Uses `dokploy compose update` (rewrite the image tag) and `compose redeploy`
(trigger) for POSTs, which work fine, but talks to the Dokploy tRPC API directly via `curl` for
status polling — as of `@dokploy/cli` 0.29.4, its `apiGet` helper omits tRPC's `{ json: ... }`
superjson wrapper on query params, so every GET-style read endpoint that takes params
(`compose.one`, `deployment.allByCompose`, `compose.search`, `project.one`, …) 400s through the
CLI; POST-style ones (`compose.update`, `compose.redeploy`, `project.all`) are unaffected. This is
a CLI bug (confirmed by hitting the same endpoints directly with the wrapper added), not an
auth/access problem — the script works around it rather than waiting on an upstream fix.

## Running individually

### Relay

```bash
docker run -d --name pi-studio-relay -p 7000:7000 pi-studio-relay
```

Stateless, no volumes. Env: `PI_STUDIO_RELAY_LISTEN` (default `0.0.0.0:7000`),
`PI_STUDIO_RELAY_LOG_LEVEL` (default `info`; `trace` adds per-frame byte counts),
`PI_STUDIO_RELAY_LOG_DIR` (also write rotating NDJSON files there). The relay always logs its
connection/session lifecycle to stdout as NDJSON, so `docker logs -f pi-studio-relay` shows
registrations, detaches, and per-connection traffic stats out of the box.

### Daemon

```bash
docker run -d --name pi-studio-daemon \
  -p 6767:6767 \
  -e PI_STUDIO_PASSWORD=hunter2 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v pi-studio-data:/data \
  -v /abs/path/to/projects:/workspace \
  pi-studio-daemon
```

| Env | Default | Purpose |
|---|---|---|
| `PI_STUDIO_LISTEN` | `0.0.0.0:6767` | Bind address |
| `PI_STUDIO_HOME` | `/data` | State dir (mount a volume here) |
| `PI_STUDIO_PASSWORD` | _(unset)_ | Connection password |
| `PI_STUDIO_LOG_LEVEL` | `info` | pino level; `debug` adds per-RPC request lines |
| `PI_STUDIO_RELAY_ENABLED` / `_ENDPOINT` / `_USE_TLS` | `false` / — / `false` | Dial out to a relay |
| `PI_STUDIO_APP_BASE_URL` | `https://app.molagent.ai` | Pairing link origin (`daemon pair`) — the compose stack sets this to `http://localhost:${PI_STUDIO_WEB_PORT:-8080}` |

The daemon logs its full lifecycle to stdout as NDJSON (startup, client connect/disconnect, agent
create/turn lifecycle, terminal open/exit, `pi` process spawn/exit, relay dial events), so
`docker logs -f pi-studio-daemon` works out of the box; a rotating copy also lands in
`/data/logs/` on the data volume.

### Web UI

```bash
docker run -d --name pi-studio-web-client -p 8080:8080 \
  -e PI_STUDIO_DAEMON_UPSTREAM=daemon-host:6767 \
  pi-studio-web-client
```

Static SPA on `:8080`, no volumes. The daemon URL is entered at runtime in the toolbar (or via
`?host=…&connect=1`). `PI_STUDIO_DAEMON_UPSTREAM` (default `daemon:6767`) is only the target of the
optional same-origin `/daemon-ws` proxy — set it if you want the browser to reach the daemon
through the web server's origin (`ws://<web-host>:8080/daemon-ws`) instead of the daemon port.

## Volumes

- **`/data`** (`PI_STUDIO_HOME`) — persistent daemon state: agent records, the Curve25519
  `daemon-keypair.json`, `server-id`, `pi-studio.pid`, `logs/`, the `projects/` registries, and
  `extensions-state.json` (preinstalled-extensions sync bookkeeping). Use a named volume so
  agents, projects, the relay identity, and extensions-sync history survive restarts.
- **`/workspace`** — bind-mount the host directories your agents operate on. Agents spawn their
  provider process (and terminals, git, worktrees) in these `cwd`s, so the paths you open via the
  client (e.g. `pi-studio open /workspace/my-repo`) must exist inside the container.
- **Preinstalled-extensions sync and `PI_STUDIO_HOME` vs. the pi-home**: the bundled `pi`'s own
  config dir (`~/.pi/agent`, holding `settings.json` — where recommended extensions actually get
  installed) is **separate** from `/data`/`PI_STUDIO_HOME` unless `daemon.piHome` /
  `PI_STUDIO_PI_HOME` redirects it under `/data` too. Neither is volume-mounted by this compose
  setup out of the box, so **every container recreate starts from a fresh pi-home**: sync sees no
  prior `extensions-state.json` entry for that pi-home and re-offers the full `core` set —
  harmless (idempotent `pi install`), but means the extension set is reinstalled on every
  recreate rather than persisted. To persist it, point `daemon.piHome` (or `PI_STUDIO_PI_HOME`) at
  a path under `/data` and keep the existing `/data` volume mounted.

## pi provider auth

The `pi` CLI is bundled in the image, but it still needs credentials. Either:

- set **`ANTHROPIC_API_KEY`** (or another provider key) in the daemon's environment, or
- mount your host credentials read-only — uncomment the `auth.json` line in `docker-compose.yml`:
  `- "${HOME}/.pi/agent/auth.json:/home/node/.pi/agent/auth.json:ro"`.

Without credentials the `pi` provider surfaces a clean `rpc_error`; the built-in **`mock`** provider
works with no credentials for smoke tests.

## Security notes

- The relay is **zero-knowledge** — it forwards ciphertext verbatim and never sees message contents.
  The **daemon** port, however, is a plain WebSocket endpoint: set `PI_STUDIO_PASSWORD` and/or keep
  it off untrusted networks. TLS (`wss`/`https`) is expected to be terminated by a reverse proxy in
  front of the daemon; the container itself speaks plaintext HTTP.
- Both images run as the non-root `node` user.
- `GET /api/health` (daemon) and `GET /health` (relay) are exempt from auth/host checks for probes.
