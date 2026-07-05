# Pi-Studio — Root AGENTS.md

> **Coding-agent orientation for the whole monorepo.**
> Read this file first, then open the per-package `AGENTS.md` for the area you are working in.

---

## What this project is

Pi-Studio is a **self-hosted, local-first system** for running and controlling the **Pi** AI coding
agent. A long-lived **daemon** process runs on a developer's machine, manages agent processes,
PTY terminals, git worktrees, projects, chat rooms, schedules, and loops, and exposes a
**WebSocket JSON+binary API**. Clients — a CLI today, mobile/web/desktop apps in later sprints —
connect to the daemon to observe and drive agents.

Your code never leaves your machine.

---

## Monorepo layout

```
packages/
  protocol/   Wire schemas (Zod), binary frame codecs, capability flags — zero runtime deps except zod.
  client/     Low-level WS driver (DaemonClient) + PiStudioClient SDK facade.
  server/     The daemon: agents, terminals, git, projects, orchestration, WS/HTTP, persistence.
  cli/        pi-studio terminal client + local daemon lifecycle control (commander).
  highlight/  Server-side syntax-highlight helper (pure-JS tokeniser, no external deps).
  relay/      Encrypted relay bridge for remote access (placeholder, later sprint).
  app/        Cross-platform Expo client (placeholder, later sprint).
  desktop/    Electron shell wrapping a bundled daemon (placeholder, later sprint).

poc/                Throwaway vanilla-JS browser UI for visual feature testing.
clean-room-scope/   Technical specifications (MAIN-SCOPE.md is the entry point).
specs/              Additional spec documents.
docs/               Project docs.
```

### Dependency graph (compile-time)

```
protocol  ─────────────────────────────────────────► (no workspace deps)
highlight ─────────────────────────────────────────► (no workspace deps)
relay     ─────────────────────────────────────────► (no workspace deps)
client    ──────► protocol
server    ──────► protocol, highlight
cli       ──────► protocol, client
app       ──────► protocol, client
desktop   ──────► app, server
```

`protocol` is the single shared contract; nothing below it imports from above.

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript 5 (ESM, `"type": "module"`) |
| Runtime | Node.js ≥ 20 (Node 24 in active development) |
| Build | `tsc -b` per package; root `npm run build` chains them in dependency order |
| Testing | Vitest (`npm test` at root) |
| Lint | oxlint (`npm run lint`) |
| Format | oxfmt (`npm run fmt`) |
| Schema validation | Zod 3 |
| WS library | `ws` (server), native `WebSocket` / injected transport (client) |
| PTY | `node-pty` |
| Terminal emulation | `@xterm/headless` |
| Logging | `pino` + `pino-pretty` + `rotating-file-stream` |
| CLI framework | `commander` |
| QR codes | `qrcode` |
| Auth | `bcryptjs` (password hashing), `tweetnacl` (keypair for relay pairing) |

---

## Tooling commands (run from repo root)

```bash
npm install                   # install all workspace deps
npm run build                 # build all packages in dependency order
npm run build:<pkg>           # e.g. npm run build:server
npm test                      # vitest run (full suite)
npm run typecheck             # tsc -b across all packages
npm run lint                  # oxlint
npm run fmt:check             # oxfmt --check
npm run fmt                   # oxfmt (auto-fix)
npm run clean                 # rm dist/ and *.tsbuildinfo everywhere

# Run the daemon (builds server first)
npm start
# Start without rebuilding
npm run start:server          # node packages/server/dist/daemon/main.js

# Dev daemon (all features wired, binds 0.0.0.0)
npm run dev:daemon
# Serve the POC browser UI
npm run poc
```

---

## Daemon configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_STUDIO_HOME` | `~/.pi-studio` | State, config, logs directory |
| `PI_STUDIO_LISTEN` | `127.0.0.1:6767` | Daemon bind address (`host:port`) |
| `PI_STUDIO_PASSWORD` | _(unset)_ | Bcrypt-checked connection password |
| `PI_STUDIO_HOSTNAMES` | `localhost,*.localhost` | Allowed `Host` header values |
| `PI_STUDIO_SERVER_ID` | _(generated UUID)_ | Stable server identity |

Also reads `$PI_STUDIO_HOME/config.json`.

---

## Protocol overview

All communication uses a **single WebSocket connection** per client.

- **Text frames** carry JSON envelopes discriminated by `type`:
  - `hello` (Client→Server, first frame, handshake)
  - `status` (Server→Client, `server_info` payload after hello)
  - `ping` / `pong` (JSON liveness, NOT RFC 6455 ping — browser/RN cannot access protocol ping)
  - `session` (envelope wrapping all RPC request/response/broadcast messages)
  - `rpc_error` (correlated error response)
- **Binary frames** carry terminal and file-transfer data with a 2-byte header `[opcode][slot]`.
- All schemas are **append-only**: new optional fields only, types never narrowed, fields never removed.
- RPC names follow a dotted convention: `domain.provider.operation.direction`
  (e.g. `agent.permission.respond.request`). Legacy flat names are accepted but never generated.

---

## Agent provider model

The daemon is **provider-agnostic**. The `AgentClient` / `AgentSession` interfaces in
`packages/server/src/agent/provider-contract.ts` are the only surface the rest of the daemon touches.
Two providers ship today:

- **`pi`** — spawns `pi --mode rpc` (bundled inside `@earendil-works/pi-coding-agent`), speaks the
  Pi JSONL RPC protocol, maps Pi events to `AgentStreamEvent`s.
- **`mock`** — in-process stub that emits synthetic events; needs no credentials; used for smoke
  testing.

Custom Pi-compatible profiles can extend the `pi` provider via `"extends": "pi"` in the manifest.

---

## Persistence layout (`$PI_STUDIO_HOME/`)

```
config.json           Daemon config (password hash, provider overrides, service proxy, …)
pi-studio.pid         PID lock (prevents duplicate daemons)
logs/                 Rotating NDJSON log files (pino)
agents/
  <sanitized-cwd>/
    <agentId>.json    Agent record (status, config, timeline seq, labels, …)
chat/
  rooms.json          Chat rooms + messages
loops/
  <loopId>.json       Loop records
schedules/
  <scheduleId>.json   Schedule records
projects.json         Project registry
workspaces.json       Workspace registry
```

All entity files use `.passthrough()` schemas and optional fields — unknown/future fields are
tolerated without a migration framework.

---

## Key invariants / coding conventions

1. **Append-only wire protocol.** Never remove or narrow a field in `packages/protocol`. Add new
   optional fields only.
2. **`protocol` has zero workspace imports.** It must remain usable by browser/RN clients.
3. **Provider isolation.** `packages/server/src/agent/provider-contract.ts` is the only interface
   the server imports; never import `pi/` or `mock/` directly from outside the `agent/` directory.
4. **RPC handler registration is explicit.** Use `HandlerRegistry.register()` in a bootstrap/
   dev-bootstrap module, not auto-discovery.
5. **All schemas use `.passthrough()` and optional fields** so old daemons can load data written by
   newer ones.
6. **`rpcTimeoutMs` ≠ socket death.** An RPC timeout is an operation-level failure; it must not
   close or trigger reconnect on the WebSocket.
7. **`~` in `cwd` is expanded server-side** to the home directory before passing to the agent.
8. **Binary frame codec is cross-platform** (Uint8Array, no Node Buffer) so it runs in browsers
   and React Native as well as Node.

---

## Where to find specifications

- `clean-room-scope/MAIN-SCOPE.md` — system overview and package responsibilities
- `clean-room-scope/architecture/` — deep dives (websocket-protocol, persistence, agent-lifecycle,
  client-app-runtime, daemon-bootstrap, relay-e2ee, …)
- `clean-room-scope/features/` — feature-level specs (agent-sessions, terminals, cli, projects-
  workspaces, git-checkout, chat-rooms, loops, schedules, file-explorer-transfer, …)

---

## Package AGENTS.md index

| Package | File |
|---------|------|
| protocol | `packages/protocol/AGENTS.md` |
| client | `packages/client/AGENTS.md` |
| server | `packages/server/AGENTS.md` |
| cli | `packages/cli/AGENTS.md` |
| highlight | `packages/highlight/AGENTS.md` |
| relay | `packages/relay/AGENTS.md` |
| app | `packages/app/AGENTS.md` |
| desktop | `packages/desktop/AGENTS.md` |
