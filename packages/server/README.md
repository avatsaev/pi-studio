# `@av-pi-studio/server`

The **Pi-Studio daemon** — the long-lived server process that runs on a developer's machine and is
the heart of Pi-Studio. It supervises AI-agent processes, PTY terminals, git worktrees, projects,
chat rooms, schedules, and loops, and exposes a single **WebSocket JSON+binary API** (plus a small
HTTP surface) that every client — the CLI, the web UI, and future native apps — connects to.

Your code never leaves your machine: the daemon runs locally, talks to the `pi` agent locally, and
persists all state under a local home directory.

---

## Table of contents

- [What the daemon does](#what-the-daemon-does)
- [Requirements](#requirements)
- [Install & build](#install--build)
- [Running the daemon](#running-the-daemon)
- [Configuration](#configuration)
- [The wire API](#the-wire-api)
- [Agent providers](#agent-providers)
- [Persistence](#persistence)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Logging](#logging)
- [Development](#development)
- [Key invariants](#key-invariants)

---

## What the daemon does

A single daemon process owns all runtime state and mediates every operation:

- **Agents** — creates, runs, interrupts, updates, resumes, and archives AI coding-agent sessions
  through a provider-neutral interface. Streams every turn event (assistant messages, reasoning,
  tool calls, completion) to subscribed clients in real time.
- **Terminals** — spawns and multiplexes PTY processes over the same WebSocket using binary frames,
  with screen-buffer snapshots so late subscribers see the current screen.
- **Projects & git** — opens projects, tracks workspaces, runs git status/branch/diff/commit,
  manages worktrees, and integrates with the GitHub API for PRs/issues.
- **Orchestration** — chat rooms with `@mentions`, cron/interval **schedules** that fire agent
  prompts, and iterative worker+verifier **loops**.
- **Files** — directory listing, text/binary file preview, and token-based chunked file download.
- **Service proxy** — an HTTP reverse proxy that routes to localhost services started by agents.

The daemon is **provider-agnostic**: the rest of the code only ever touches the `AgentClient` /
`AgentSession` interfaces in `src/agent/provider-contract.ts`. Two providers ship today — the real
`pi` provider and an in-process `mock`.

---

## Requirements

- **Node.js ≥ 20** (developed and tested on Node 24). ESM only (`"type": "module"`).
- **npm** with workspaces (this package lives in the Pi-Studio monorepo).
- For the real **`pi` provider**: pi *credentials* only. The `pi` CLI is bundled as a dependency
  (`@earendil-works/pi-coding-agent`) — the daemon launches `node <pkg>/<pi's declared bin> --mode
  rpc` (`dist/bundle/cli.js` as of Pi 0.84.4), so
  **no global `pi` install is required**. Provide credentials via an API key
  (`ANTHROPIC_API_KEY`, etc.) in the daemon's environment, or a configured `~/.pi/agent/auth.json`.
- The built-in **`mock` provider** needs **no credentials** and is ideal for smoke tests.

---

## Install & build

From the monorepo root:

```bash
npm install            # install all workspace deps
npm run build:server   # build this package (compiles protocol + highlight first via project refs)
```

Or build everything: `npm run build`.

The build emits `dist/`. The production entry point is `dist/daemon/main.js`, also exposed as the
`pi-studio-daemon` bin.

---

## Running the daemon

### Simplest (from monorepo root)

```bash
npm start              # builds the server, then runs the daemon in the foreground
npm run start:server   # runs the already-built daemon without rebuilding
```

Directly:

```bash
node packages/server/dist/daemon/main.js
```

On startup the daemon prints its identity and readiness:

```
pi-studio daemon listening on http://0.0.0.0:6767
  serverId: 3f2a…
  home:     /home/you/.pi-studio
  provider: pi
  ws: ready
  Press Ctrl+C to stop
```

By default the daemon:

- listens on **`0.0.0.0:6767`** (override with `PI_STUDIO_LISTEN`) — reachable over the LAN
- stores all state under **`$PI_STUDIO_HOME`** (default **`~/.pi-studio`**)
- writes logs to **`$PI_STUDIO_HOME/logs/`**
- uses the **`pi`** provider

It runs in the foreground; **Ctrl-C** (SIGINT) or SIGTERM triggers a clean shutdown that closes the
HTTP/WS servers and releases resources.

### Verify it's up

```bash
curl http://127.0.0.1:6767/api/health
# → {"status":"ok"}
```

`/api/health` is exempt from Host-allowlist and auth checks, so it always answers.

### Dev daemon

`src/daemon/dev-main.ts` is a development entry that wires only a **minimal handler subset**
(`dev-bootstrap.ts`: agent list/archive/delete, workspaces/projects listing, providers, file
read/diff, schedule listing — no terminals, git ops, worktrees, chat, loops, or relay), the mock
provider, and in-memory state, and binds `0.0.0.0` with developer-friendly defaults. From the root:

```bash
npm run dev:daemon
```

> `bootstrap.ts` (production) registers the **full** RPC surface — agents, terminals, git/worktrees/
> GitHub, files, service proxy, schedules/chat/loops, rewind, optional outbound relay — with the
> real provider and disk persistence. `dev-bootstrap.ts` stays intentionally minimal for fast local
> iteration and **must never grow to duplicate that surface**; `bootstrap.ts` must never import
> `dev-bootstrap.ts` (the reverse — `dev-bootstrap.ts` importing one shared helper,
> `wrapSessionEnvelope`, from `bootstrap.ts` — is fine and is what happens today).

### Docker

A production daemon image (multi-stage, compiles the native `node-pty` addon, ships `git` + the
bundled `pi` runtime) lives at `docker/daemon.Dockerfile`, with a compose file that also runs the
relay. From the repo root:

```bash
cd docker && docker compose up --build   # daemon :6767 + relay :7000
```

`$PI_STUDIO_HOME` is `/data` (mount a volume); bind-mount your projects at `/workspace`. See
`docker/README.md` for the full env/volume/auth/security matrix.

---

## Configuration

Configuration comes from two sources, merged with **environment variables winning** over the file:

1. `$PI_STUDIO_HOME/config.json` (optional — a missing or corrupt file is treated as `{}`).
2. Environment variables (overlaid last).

### Environment variables

All optional.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_STUDIO_HOME` | `~/.pi-studio` | State + config + logs directory |
| `PI_STUDIO_LISTEN` | `0.0.0.0:6767` | Daemon listen address (`host:port`) |
| `PI_STUDIO_PASSWORD` | _(unset)_ | Require this password for connections (bcrypt-checked) |
| `PI_STUDIO_HOSTNAMES` | `localhost,*.localhost` | Allowed `Host` header values (comma-separated, or `true` to allow all) |
| `PI_STUDIO_SERVER_ID` | _(persisted/generated)_ | Stable server identity |
| `PI_STUDIO_RELAY_ENABLED` | `false` | Opt into the outbound relay dial (env equivalent of `daemon.relay.enabled`; `1`/`true`/`yes`/`on`) |
| `PI_STUDIO_RELAY_ENDPOINT` | _(unset)_ | Relay server to dial outbound to when `daemon.relay.enabled` (`host:port`) |
| `PI_STUDIO_RELAY_USE_TLS` | `false` | Use `wss://` for the outbound relay dial (`1`/`true`/`yes`/`on`) |
| `PI_STUDIO_RELAY_PUBLIC_ENDPOINT` | _(unset)_ | Client-facing relay address, if different from the daemon's own dial target |
| `PI_STUDIO_RELAY_PUBLIC_USE_TLS` | `false` | TLS setting for the client-facing relay address (independent of the outbound dial) |
| `PI_STUDIO_SERVICE_PROXY_LISTEN` | _(unset)_ | Service-proxy listen address |
| `PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL` | _(unset)_ | Public base URL advertised for proxied services |
| `PI_STUDIO_SERVICE_PROXY_ENABLED` | _(unset)_ | Enable the service proxy (`1`/`true`/`yes`/`on`) |
| `PI_STUDIO_APP_BASE_URL` | `https://app.molagent.ai` | Pairing link origin (`daemon pair`) — set to your own web-client URL for self-hosted/local pairing |

> Literal IP addresses always pass the Host allowlist, so binding `0.0.0.0` and connecting via the
> server's IP needs no extra config. To reach the daemon by **hostname**, add it to
> `PI_STUDIO_HOSTNAMES`.

Example — isolated home, custom port, password:

```bash
PI_STUDIO_HOME=/tmp/pi-studio-dev \
PI_STUDIO_LISTEN=127.0.0.1:6790 \
PI_STUDIO_PASSWORD=hunter2 \
node packages/server/dist/daemon/main.js
```

### `config.json`

The persisted config is validated by a Zod schema (`src/config/daemon-config.ts`) with sane
defaults and `.passthrough()` tolerance for unknown/future keys. Notable sections:

```json
{
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:6767",
    "hostnames": ["localhost", "*.localhost"],
    "auth": { "password": "$2b$…bcrypt-hash…" },
    "mcp": { "enabled": true, "injectIntoAgents": true },
    "appendSystemPrompt": "",
    "cors": { "allowedOrigins": [] },
    "serviceProxy": { "enabled": false },
    "relay": { "enabled": false, "endpoint": "relay-host:7000", "useTls": false }
  },
  "agents": {
    "providers": {
      "pi": { "command": ["/abs/path/to/pi", "--mode", "rpc"] }
    }
  },
  "log": { "level": "info", "format": "json" }
}
```

To use a **different `pi` binary** than the bundled one, set
`agents.providers.pi.command` to an absolute path as shown above. Custom Pi-compatible profiles can
extend the `pi` provider via `"extends": "pi"` (a custom provider must also set a `label`).

**Relay (opt-in, off by default):** with `daemon.relay.enabled: true`, the daemon dials outbound
to the `endpoint` (a self-hosted `@av-pi-studio/relay` server or Cloudflare Workers deployment)
after the WS server is up, so remote clients can reach it without an inbound port. It registers
under a **deterministic** rendezvous session id derived from its own persistent public key
(`deriveRelaySessionId`, `@av-pi-studio/relay`) — the same id on every (re)connect, so a pairing
link printed once (`pi-studio daemon pair`) keeps working across relay drops/restarts. See
`@av-pi-studio/relay`'s README for running a relay (`pi-studio-relay` bin / `pi-studio relay
start`). Direct WebSocket connections are completely unaffected either way — the relay only adds
an additional connection path.

The same pairing link can be opened by any number of clients over the daemon's lifetime — each
one gets its own fresh E2EE handshake and its own daemon-side `Session` (see `relay-transport.ts`'s
`onHandshake` → `bootstrap.ts`'s `resetRelaySession()`); connecting a second client after a first
one disconnected is a normal, supported reconnection, not a re-pairing.

Terminal I/O and file-transfer chunks work over a relay connection too — the daemon and client
encrypt binary application data as the relay channel's `e2ee_bin` frame (a base64-wrapped JSON
text frame, not a raw binary WebSocket frame; see `@av-pi-studio/relay`'s README § Wire protocol),
so no daemon or web-client feature is direct-connection-only.

---

## The wire API

All communication rides a **single WebSocket connection** per client.

### Text frames — JSON envelopes discriminated by `type`

- `hello` (Client→Server, first frame) — handshake with `clientId`, `clientType`
  (`mobile`/`browser`/`cli`/`mcp`), `protocolVersion`, optional `capabilities`.
- `status` (Server→Client) — `server_info` payload sent right after a successful hello.
- `ping` / `pong` — **JSON** liveness (not RFC 6455 ping, which browsers/RN can't send).
- `session` — the envelope wrapping every RPC request/response/broadcast (`{ type: "session",
  message }`).
- `rpc_error` — a correlated error response (carries the originating `requestId`).

A non-`hello` first frame closes the socket. RPC names follow a dotted convention —
`domain.provider.operation.direction` (e.g. `agent.permission.respond.request`); legacy flat names
are accepted via aliases but never generated.

### Binary frames — terminal + file transfer

Layout: `[1-byte opcode][1-byte slot][payload]`. The `slot` (0–255) demultiplexes multiple
terminals over the one connection. Codecs use `Uint8Array` (not Node `Buffer`) so they run
unchanged in browsers and React Native. **File downloads** also ride binary frames: a client
requests a token via the `file_download_token_request` RPC, then streams `Begin → Chunk* → End`
frames via `file_download_request`; uploads consume the same frame format.

### HTTP surface

The HTTP server is intentionally minimal. Beyond liveness, its only application route in production
is the **service proxy** (reverse proxy to localhost services started by agents).

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/health` | none | Liveness — `{ "status": "ok" }` |
| `OPTIONS *` | none | CORS preflight (`204`) |
| _other paths_ | bearer | Delegated to the service proxy; `404` if unmatched |

The request pipeline: health + preflight are exempt; then Host-allowlist (`403` on mismatch), CORS
headers, optional bearer auth (`401`), then application routes (`404` if unmatched).

The **schemas are the single source of truth** and are **append-only**: new fields are optional,
types are never narrowed, and fields/discriminants are never removed — so an older daemon can always
decode data written by a newer one. They live in `@av-pi-studio/protocol`.

---

## Agent providers

The daemon resolves a provider id string to an `AgentClient` via the `ProviderRegistry`. The only
surface the rest of the daemon depends on is `src/agent/provider-contract.ts`:

- `AgentClient.createSession(config, ctx)` → `AgentSession`
- `AgentSession.run(prompt, opts)` — start a turn; events emitted via `subscribe(handler)`
- `AgentSession.startTurn(prompt, opts)` — fire-and-forget turn start, returns `{ turnId }`
- `AgentSession.interrupt()` / `close()` / `update(patch)`
- `AgentSession.importSession(...)` — resume a provider-native session by its handle
- `RunOptions.images` carries `ImageAttachment[]` (wire shape `{ mimeType?, data? }`, base64); the
  provider translates it into its native prompt-image format at the boundary.

### `pi` (real)

- Spawns `pi --mode rpc` (bundled, or a configured `command`) and speaks **strict JSONL RPC** over
  stdin/stdout (`PiRpcTransport`).
- `event-mapper.ts` maps raw Pi events (`assistant_message`, `tool_call`, `turn_completed`, …) into
  the normalized `AgentStreamEvent` stream.
- Discovers models/modes via top-level `get_modes`/`get_models` RPCs (no scratch session).
- **Prompt images:** `startTurn` converts the wire shape `{ mimeType, data }` into Pi's
  `ImageContent` shape `{ type: "image", data, mimeType }` before the `prompt` RPC.
- **Resuming a session** (`resumeSession`, used by the lazy resume-on-send path and by
  `importSession`) spawns a fresh `pi --mode rpc` process, then issues `switch_session` to load
  the persisted JSONL file into it — RPC mode has no CLI flag to preload a session at spawn, only
  this RPC command.
- A literal `~` in `cwd` is expanded to the home directory before spawning.
- A missing/unresolvable `pi` surfaces as a clean `rpc_error` ("Pi provider unavailable…") rather
  than crashing the daemon.

### `mock` (in-process)

Emits synthetic events on a small timer loop. No credentials. Used for smoke tests and CI.

---

## Persistence

All state lives under `$PI_STUDIO_HOME/`. Every write goes through `AtomicStore`
(write-to-temp-then-rename) for crash safety.

```
config.json                      Daemon config (password hash, provider overrides, relay, service proxy, …)
pi-studio.pid                    PID lock (prevents a second daemon owning this home)
server-id                        Stable server identity (plain UUID via randomUUID())
daemon-keypair.json              Persistent Curve25519 keypair (pairing / outbound relay E2EE)
logs/                            Rotating NDJSON log files (pino)
agents/
  <sanitized-cwd>/
    <agentId>.json               Agent record (status, config, timeline seq, labels, …)
chat/rooms.json                  Chat rooms + messages
loops/loops.json                 ALL loop records (single queued-write file, NOT one file per loop)
schedules/<scheduleId>.json      Schedule records
projects/projects.json           Project registry
projects/workspaces.json         Workspace registry
```

All entity schemas use `.passthrough()` and optional fields — unknown/future fields from a newer
daemon load silently, so there is no migration framework to maintain.

---

## Architecture

```
src/
  daemon/
    main.ts             Production entry: parse env, wire bootstrap.ts, listen, handle signals.
    dev-main.ts         Dev entry: wires dev-bootstrap.ts (all features, LAN bind).
    bootstrap.ts        Production handler wiring (full RPC surface, real provider, disk state).
    dev-bootstrap.ts    Dev handler wiring (local testing only).
    orchestration-rpc.ts

  agent/                Agent lifecycle, provider registry, timeline, permissions.
    agent-manager.ts    Single source of truth for agent state + FSM + persistence + broadcast.
    agent-service.ts    RPC handler wiring for agent operations.
    provider-contract.ts  AgentClient / AgentSession interfaces (the ONLY provider surface).
    provider-registry.ts  Register/resolve AgentClient by provider id.
    timeline-store.ts   Append/page/cursor the agent event log.
    permissions.ts      Park + resolve tool-call permission requests.
    providers/pi/       Real Pi provider (spawn, JSONL transport, event mapper).
    providers/mock/     In-process synthetic provider.

  ws/                   WebSocket server, per-connection Session, HandlerRegistry + frame router.
  http/                 HTTP server (/api/health, downloads), Host allowlist.
  auth/                 PasswordAuth (bcrypt + WS subprotocol bearer token).
  config/               DaemonConfig (env + config.json merge) and per-project config.
  persistence/          Zod entity schemas, JSON stores, AtomicStore.
  terminal/             TerminalManager (PTY lifecycle, slot mux, snapshot, binary broadcast).
  projects/             Workspaces, projects, git ops, worktrees, GitHub, reconciliation.
  orchestration/        ChatService, ScheduleService, LoopService, cron.
  files/                File explorer + chunked download token store.
  proxy/                ServiceProxy + port registry for agent-started services.
  logging/              Pino logger factory.
  util/                 Concurrency helpers.
```

### Lifecycle FSM

`AgentManager` enforces `initializing → idle ↔ running → error → closed`. Every transition persists
the record **and** broadcasts `agent_update` to subscribers; any other field (title, labels,
config) goes through `updateRecord(id, patch)`, which persists but leaves broadcasting to the RPC
call site. Archiving soft-deletes (sets `archivedAt`). On startup, persisted records are
rehydrated with no live session re-attached; any record still stuck at `running`/`initializing`
(daemon killed mid-turn) is reconciled back to `idle` since neither status is valid without a
session — `interrupt_agent` applies the same reconciliation as a second line of defense. `running`
loops are recovered as `stopped` with an interruption log entry.

For a deeper subsystem reference, see [`AGENTS.md`](AGENTS.md) in this package and the specs under
[`swe/`](../../swe/).

---

## Security model

- **Host-header allowlist** (`src/http/host-allowlist.ts`) rejects requests whose `Host` isn't
  allowed — DNS-rebinding protection. Literal IPs always pass; `localhost`/`*.localhost` are always
  allowed; add hostnames via `PI_STUDIO_HOSTNAMES`.
- **Password auth** (`src/auth/password-auth.ts`) — optional. When a password is configured it is
  bcrypt-checked against either a `password` query param on the WS upgrade URL or a
  `pi-studio-bearer.<base64(password)>` WS subprotocol. An unset password allows all connections
  (fine for a trusted localhost-only setup; set one before exposing the daemon beyond a trusted
  network).
- **Service-proxy auth bypass is intentional** — the proxy route is deliberately not gated by
  daemon password auth (per spec).
- **RPC timeouts are operation-level**, never socket death — an `rpcTimeoutMs` expiry yields an
  `rpc_error`, it does not close or reconnect the WebSocket.

---

## Logging

The daemon logs its full operational lifecycle through one `pino` logger created in the bootstrap
(`src/logging/logger.ts`): startup (home, config, serverId), agent recovery, WS client
connect/disconnect (with close code + duration), upgrade/auth rejections, every RPC (at `debug`,
with duration; failures at `warn`), agent create/turn lifecycle (prompt *sizes*, never contents),
terminal open/kill/exit, `pi` provider process spawn/exit, and relay dial events.

Output goes to **stdout always** — pretty on a TTY, NDJSON otherwise (so `docker logs` /
journald / PM2 work out of the box) — **plus** a rotating NDJSON file under
`$PI_STUDIO_HOME/logs/` in production (both destinations, never either/or). Level comes from
`PI_STUDIO_LOG_LEVEL` (`trace`|`debug`|`info`|`warn`|`error`|`fatal`|`silent`, default `info`);
`debug` adds per-RPC request lines, `trace` is the most verbose.

---

## Development

```bash
npx vitest run packages/server           # run this package's Vitest suite
npm run typecheck                        # tsc -b across all packages
npm run lint                             # oxlint
npm run fmt:check                        # oxfmt --check
```

Tests are co-located as `*.test.ts` next to their source. Provider tests inject stub transports;
persistence tests use temporary directories; WebSocket tests use in-memory session stubs. Avoid
real wall-clock timers in tests — await real completion signals instead.

---

## Key invariants

1. **`provider-contract.ts` is the only provider surface.** Never import `providers/pi/` or
   `providers/mock/` from outside `agent/`.
2. **Handler registration is explicit.** Register handlers in `bootstrap.ts`/`dev-bootstrap.ts`, not
   via auto-discovery.
3. **Agent status changes only via `AgentManager` transitions** — never mutate a record directly.
4. **All entity + wire schemas use `.passthrough()` and optional fields** — newer data must load on
   older daemons.
5. **The wire protocol is append-only.** Never remove or narrow a field, never change a discriminant.
6. **`bootstrap.ts` must never import `dev-bootstrap.ts`.** (The reverse — `dev-bootstrap.ts`
   importing the shared `wrapSessionEnvelope` helper from `bootstrap.ts` — is fine and is what
   happens today.)
7. **Binary frame codecs are cross-platform** (`Uint8Array`, no Node `Buffer`).
8. **`~` in `cwd` is expanded server-side** before it reaches a provider.

