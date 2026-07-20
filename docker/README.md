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
| `PI_STUDIO_RELAY_ENABLED` / `_ENDPOINT` / `_USE_TLS` | `false` / — / `false` | Dial out to a relay |

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
  `daemon-keypair.json`, `server-id`, `pi-studio.pid`, `logs/`, and the `projects/` registries. Use
  a named volume so agents, projects, and the relay identity survive restarts.
- **`/workspace`** — bind-mount the host directories your agents operate on. Agents spawn their
  provider process (and terminals, git, worktrees) in these `cwd`s, so the paths you open via the
  client (e.g. `pi-studio open /workspace/my-repo`) must exist inside the container.

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
