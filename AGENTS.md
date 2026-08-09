# Pi-Studio — Root AGENTS.md

> **Coding-agent orientation for the whole monorepo.**
> Read this file first, then open the per-package `AGENTS.md` for the area you are working in.

---

## What this project is

Pi-Studio is a **self-hosted, local-first system** for running and controlling the **Pi** AI coding
agent. A long-lived **daemon** process runs on a developer's machine, manages agent processes,
PTY terminals, git worktrees, projects, chat rooms, schedules, and loops, and exposes a
**WebSocket JSON+binary API**. Clients — a CLI and web browser UI today, native mobile/desktop
apps in later sprints — connect to the daemon to observe and drive agents.

Your code never leaves your machine.

---

## Monorepo layout

```
packages/
  protocol/    Wire schemas (Zod), binary frame codecs, capability flags — zero runtime deps except zod.
  client/      Low-level WS driver (DaemonClient) + PiStudioClient SDK facade.
  server/      The daemon: agents, terminals, git, projects, orchestration, WS/HTTP, persistence.
  cli/         pi-studio terminal client + local daemon lifecycle control (commander).
  highlight/   Server-side syntax-highlight helper (pure-JS tokeniser, no external deps).
  relay/       E2EE relay channel primitives (Curve25519 ECDH + NaCl box) shared by daemon + client.
  web-client/  Production React/Vite browser UI — connection, chat, sessions, files, git, terminal,
               split panes (drag a tab, or a sidebar conversation/file row, onto a pane to split it;
               per-pane tab strips, persisted per workspace along with which one was in view).
  desktop/     Electron shell wrapping a bundled daemon — currently a placeholder (exports a single
               package-id constant); real implementation is sprint-033-desktop, not yet built.

swe/                Technical specifications (MAIN-SCOPE.md is the entry point).
specs/              Additional spec documents.
docs/               Monorepo-wide documentation (build layering, validation conventions). Server
                    architecture docs live in `packages/server/docs/`.
docker/             Dockerfiles + compose for the daemon, relay, and web UI (see docker/README.md).
```

### Dependency graph (compile-time, from each package's `package.json`)

```
protocol    ─────────────────────────────────────────► (no workspace deps)
highlight   ─────────────────────────────────────────► (no workspace deps)
relay       ─────────────────────────────────────────► (no workspace deps)
client      ──────► protocol, relay
server      ──────► protocol, highlight, relay
cli         ──────► protocol, client, relay, server, web-client
web-client  ──────► protocol, client
desktop     ──────► server   (NOT web-client yet — planned for sprint-033-desktop, not wired)
```

`cli` depends on `server` and `web-client` NOT to import their runtime code, but to (a) resolve
`@av-pi-studio/server`'s/`@av-pi-studio/relay/server`'s absolute module URL via
`import.meta.resolve` for spawning a detached daemon/relay subprocess, and (b) ship
`web-client`'s prebuilt static SPA assets for the `pi-studio web` command. See
`packages/cli/AGENTS.md`.

`protocol` is the single shared contract; nothing below it imports from above.

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript 7 (ESM, `"type": "module"`) |
| Runtime | Node.js ≥ 20 (Node 24 in active development) |
| Build | `tsc -b` per package; root `npm run build` chains them in dependency order |
| Testing | Vitest (`npm test` at root) |
| Lint | oxlint (`npm run lint`) |
| Format | oxfmt (`npm run fmt`) |
| Schema validation | Zod 3 |
| WS library | `ws` (server), native `WebSocket` / injected transport (client) |
| Agent runtime | `@earendil-works/pi-coding-agent` (bundles `pi --mode rpc`, the `pi` provider spawns it) |
| PTY | `node-pty` |
| Terminal emulation | `@xterm/headless` |
| Logging | `pino` + `pino-pretty` + `rotating-file-stream` |
| CLI framework | `commander` |
| Interactive terminal prompts | `@inquirer/prompts` (cli only — `auth login` picker/masked input; lazy-imported) |
| QR codes | `qrcode` |
| Auth | `bcryptjs` (password hashing), `tweetnacl` (keypair for relay pairing) |
| Molecular structure viewer | `@molviewer/core` (web-client only — molecule/crystal file viewer, lazy-loaded `vendor-molviewer` chunk) |

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

# Run the production daemon (real Pi provider, disk persistence, full RPC surface; builds server first)
npm start
# Start without rebuilding
npm run start:server          # node packages/server/dist/daemon/main.js

# Dev daemon (in-memory persistence, mock provider only, minimal handler set, binds 0.0.0.0)
npm run dev:daemon

# Docker: build + run daemon (:6767), relay (:7000), web UI (:8080); daemon dials the relay
cd docker && docker compose up --build   # see docker/README.md
```

---

## Release & production deployment

`npm run release` (`scripts/release.sh`) chains all three steps below end-to-end: bump+publish npm
packages, build+push Docker images tagged to match, then pin+deploy production on that exact tag.
Pure orchestration — no logic beyond what the three scripts already do; each remains independently
runnable (and this is what `release.sh` calls under the hood).

```bash
npm run release                    # full pipeline: publish npm -> publish docker -> deploy
npm run release -- --dry-run       # steps 1+2 in dry-run; step 3 is skipped (nothing to deploy)
npm run release -- --no-bump       # publish the current npm version as-is, no version bump
npm run release -- --skip-npm      # npm already published — start from the on-disk version
npm run release -- --skip-docker   # images already pushed for this version
npm run release -- --skip-deploy   # publish only; deploy separately/later
npm run release -- relay           # (forwarded to step 3) deploy relay only
npm run release -- web-client      # (forwarded to step 3) deploy web-client only
```

Or run the three steps individually — each is idempotent and safe to re-run on its own:

```bash
# 1. Publish npm packages — bumps every workspace package to one aligned patch version,
#    rewrites internal @av-pi-studio/* deps to match, builds+typechecks+tests, then publishes
#    protocol/highlight/relay/client/web-client/server/cli to npm in that dependency order.
#    Requires: npm login. Aborts if the git working tree isn't clean.
npm run publish
npm run publish -- --dry-run     # do everything except the actual `npm publish`
npm run publish -- --no-bump     # publish current versions as-is, no version bump

# 2. Build + push Docker images — builds pi-studio-{relay,daemon,web-client} from local source,
#    boot-smoke-tests web-client (runs it, curls for a 200) before pushing anything, then tags
#    and pushes to Docker Hub under avatsaev/pi-studio-{relay,daemon,web-client}. ALWAYS pass
#    --tag matching step 1's version — step 3 deploys against that exact tag, not `:latest`
#    (see step 3's note on why `:latest` alone doesn't work).
#    Requires: docker login with push access.
npm run docker:publish -- --tag 0.0.13
npm run docker:publish -- --dry-run      # build+smoke-test, skip the push

# 3. Deploy to production — pins the `relay`/`web-client` compose stacks on Dokploy (project
#    `molagent-platform`, https://infra.molagent.ai) to a CONCRETE version tag (default: the
#    repo's current package.json version) and redeploys. Pinning matters: Dokploy's deploy
#    command never runs `docker compose pull`, so a bare/`:latest` image reference already
#    cached on the host silently keeps serving the OLD container even after a "successful"
#    redeploy (real incident: 2026-07-22, app.molagent.ai served a two-day-old build through
#    multiple redeploys until this was found and fixed). Rewriting the compose file's tag on
#    every deploy forces Dokploy to detect a real diff and actually pull+recreate.
#    Requires the tag from step 2 to already exist on Docker Hub, and the `dokploy` CLI
#    (https://github.com/Dokploy/cli) installed and authenticated (`dokploy auth`). Does NOT
#    build/push images itself — run AFTER step 2. The daemon is intentionally NOT deployed here
#    — only relay + web UI run on molagent-platform; the daemon is self-hosted per user.
npm run docker:deploy
npm run docker:deploy -- relay        # one service only
npm run docker:deploy -- web-client
npm run docker:deploy -- --tag 0.0.12 # pin to a specific version (e.g. a hotfix rollback)
npm run docker:deploy -- --no-wait    # trigger, don't poll for completion
```

Production endpoints: `https://relay.molagent.ai` (relay, health at `/health`), `https://app.molagent.ai`
(web-client SPA). See `docker/README.md` for the full detail on all three scripts, including a
known `@dokploy/cli` 0.29.4 bug (`dokploy-deploy.sh`'s header comment) that makes several of the
CLI's own read/list subcommands 400 — the deploy script works around it by talking to the Dokploy
tRPC API directly via `curl` for status polling, rather than waiting on an upstream fix.

---

## Daemon configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_STUDIO_HOME` | `~/.pi-studio` | State, config, logs directory |
| `PI_STUDIO_PI_HOME` | _(unset, Pi CLI defaults to `~/.pi`)_ | Redirects the bundled Pi CLI's own `.pi` config dir (`models.json`, `auth.json`, `settings.json`, session JSONL files, …) — separate from `PI_STUDIO_HOME`, which is Pi-Studio's own daemon state. Sets `PI_CODING_AGENT_DIR=<dir>/agent` and `PI_CODING_AGENT_SESSION_DIR=<dir>/agent/sessions` for every spawned `pi` process; also settable via `daemon.piHome` in `config.json`, or per-provider `agents.providers.pi.env` (which wins over both). `pi-studio --pi-home <dir> daemon start` sets this for a locally-spawned daemon (`--pi-home` is a **root** option — it must precede the subcommand, since the CLI's root program uses Commander's `enablePositionalOptions()`). The same `--pi-home`/env resolution selects the `auth.json` that `pi-studio auth login`/`status`/`logout` read and write (`packages/cli`'s `auth-runtime.ts`), so a credential entered via the CLI is the exact one a daemon started against the same `--pi-home` hands to its spawned `pi --mode rpc` agents — see `packages/cli/AGENTS.md`'s `auth` group section. |
| `PI_STUDIO_LISTEN` | `0.0.0.0:6767` (production `main.ts`); the CLI's local-spawn path binds `127.0.0.1:6767` instead | Daemon bind address (`host:port`) |
| `PI_STUDIO_PASSWORD` | _(unset)_ | Bcrypt-checked connection password |
| `PI_STUDIO_HOSTNAMES` | `localhost,*.localhost` | Allowed `Host` header values (`true` disables validation) |
| `PI_STUDIO_SERVER_ID` | _(generated UUID)_ | Stable server identity |
| `PI_STUDIO_LOG_LEVEL` | `info` | pino log level (`trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent`) |
| `PI_STUDIO_RELAY_ENABLED` | `false` | Opt into dialing the outbound relay (env equivalent of `daemon.relay.enabled`) |
| `PI_STUDIO_RELAY_ENDPOINT` / `PI_STUDIO_RELAY_PUBLIC_ENDPOINT` | _(unset)_ | Override `config.json`'s `daemon.relay.endpoint`/`publicEndpoint` (opt-in outbound relay) |
| `PI_STUDIO_RELAY_USE_TLS` / `PI_STUDIO_RELAY_PUBLIC_USE_TLS` | _(unset)_ | Override relay TLS flags |
| `PI_STUDIO_SERVICE_PROXY_LISTEN` / `_PUBLIC_BASE_URL` / `_ENABLED` | _(unset)_ | Override service-proxy config |
|`PI_STUDIO_APP_BASE_URL`|`https://app.molagent.ai`|Pairing link origin (`pi-studio daemon pair`); self-hosted deployments should point this at their own reachable web-client URL|

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
- RPC names are overwhelmingly **flat snake_case** (`create_agent_request`, `list_agents_request`,
  `chat_create_request`, `checkout_commit_request`, …) — this is the actual convention in practice,
  not a "legacy" fallback. A small minority use a dotted `domain.provider.operation.direction` form
  (`agent.permission.respond.request`, `agent.rewind.request`,
  `checkout.github.set_auto_merge.request`); where a dotted name exists, the flat form is usually
  also registered as an alias (`registry.registerAlias(flatName, dottedName)`) for compatibility.
  Do not assume dotted is canonical when adding a new handler — match the flat convention unless
  there's a specific reason to nest.
- **Per-path push subscription families** validate via the `sessionMessageBaseSchema` passthrough
  fallback rather than a `messages.ts` discriminated-union entry — `checkout_status_subscribe`/
  `_unsubscribe` + `checkout_status_update` (git status, per-session `send()`, not broadcast) and
  `file_watch_subscribe`/`_unsubscribe` + `file_changed` (filesystem changes, same per-session
  `send()` shape, `packages/server/src/files/file-watch-service.ts`) both follow this pattern. Not
  every push type needs a protocol-package schema entry — a local TypeScript interface + type guard
  at the point of use is the established convention for this family.

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
`pi` needs a model-provider credential before it can run a turn — `pi-studio auth login` (CLI-local,
no daemon required; `packages/cli/AGENTS.md`'s `auth` group) is the supported way to provide one
without hand-editing Pi's `auth.json` or discovering `/login` inside `pi-studio pi`'s pass-through
TUI.

---

## Persistence layout (`$PI_STUDIO_HOME/`)

```
config.json           Daemon config (password hash, provider overrides, relay, service proxy, …) — written 0600
pi-studio.pid         PID lock (prevents duplicate daemons)
server-id             Stable server identity (plain UUID via randomUUID()), unless PI_STUDIO_SERVER_ID is set
daemon-keypair.json   Persistent Curve25519 keypair (pairing / outbound relay E2EE) — written 0600
logs/                 Rotating NDJSON log files (pino)
agents/
  <sanitized-cwd>/
    <agentId>.json    Agent record (status, config, timeline seq, labels, …)
chat/
  rooms.json          Chat rooms + messages
loops/
  loops.json           All loop records (single queued-write file, NOT one file per loop)
schedules/
  <scheduleId>.json   Schedule records
projects/
  projects.json       Project registry
  workspaces.json     Workspace registry
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

- `swe/MAIN-SCOPE.md` — system overview and package responsibilities
- `swe/architecture/` — deep dives (websocket-protocol, persistence, agent-lifecycle,
  client-app-runtime, daemon-bootstrap, relay-e2ee, …)
- `swe/features/` — feature-level specs (agent-sessions, terminals, cli, projects-
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
| web-client | `packages/web-client/AGENTS.md` |
| desktop | `packages/desktop/AGENTS.md` |
