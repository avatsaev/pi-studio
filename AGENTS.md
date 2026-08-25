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
docs/               Monorepo-wide documentation (build layering, validation conventions, agent
                    stream events). Server architecture docs live in `packages/server/docs/`.
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

`cli` depends on `server` and `web-client` primarily NOT to import their runtime code, but to
(a) resolve `@av-pi-studio/server`'s/`@av-pi-studio/relay/server`'s absolute module URL via
`import.meta.resolve` for spawning a detached daemon/relay subprocess, and (b) ship
`web-client`'s prebuilt static SPA assets for the `pi-studio ui` command. One narrow, deliberate
exception: `pi-studio extensions list --local` (sprint-057/task-005) imports `server`'s pure
extension-planning modules (`extensions/index.ts`'s `curated-packs`/`sync-planner`/
`extensions-state`, plus `daemon-config.ts`'s `loadConfig`) in-process, to run the same read-only
planner a connected daemon runs — no daemon lifecycle, no WS server, no `pi` process spawn. See
`packages/cli/AGENTS.md`'s Invariants section for the full boundary (also covers the pre-existing
auth-engine exception).

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
#    rewrites internal @av-pi-studio/* deps to match (dependencies AND devDependencies — e.g.
#    web-client's @av-pi-studio/client/protocol, which are devDependencies since web-client ships
#    no runtime deps, only its prebuilt dist), builds+typechecks+tests, then publishes
#    protocol/highlight/relay/client/web-client/server/cli to npm in that dependency order.
#    The single version line lives in packages/*/package.json (all 8 kept identical; the script
#    reads packages/protocol/package.json as the reference). The root package.json intentionally
#    has NO "version" field — it is a private workspace root that nothing publishes and nothing
#    reads; do not add one back, or it will silently drift from the real version. Every published
#    package's "files" excludes "dist/**/*.map" and "dist/.tsbuildinfo" — build caches and source
#    maps with no consumer at runtime — so tarballs only ship usable output.
#    Immediately before publishing it also rewrites relative README image paths (`src="assets/…"`)
#    to absolute, version-pinned jsDelivr URLs
#    (`cdn.jsdelivr.net/npm/@av-pi-studio/<pkg>@<version>/assets/…`) in the tarball only, restoring
#    the working-tree files via an EXIT trap, and aborting if a README references `assets/` while
#    that package's "files" omits "assets" (the images would 404 on the CDN). npmjs.com renders
#    READMEs through GitHub's GFM API, which has no repo context, so a relative image path renders
#    broken there even though it works on github.com; `repository.directory` (on packages/cli) only
#    fixes the source link, not image URLs. raw.githubusercontent is NOT an option — this repo is
#    private, so those URLs 404 for anonymous package-page visitors. jsDelivr mirrors published npm
#    packages publicly, so the screenshots ship in the cli tarball (`assets`, ~470 KB of webp) and
#    are served from there. Screenshots are webp at 2x their README display width: PNG at this size
#    was 1.9 MB for the same four images.
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
|`PI_STUDIO_EXTENSIONS_AUTOSYNC`|`true`|Master switch for preinstalled-extensions sync (`daemon.extensions.autoSync`). `"false"`/`"0"` disables it — the daemon never touches pi's `settings.json` on boot/selection-change; a manual sync still works|
|`PI_STUDIO_EXTENSION_PACKS`|_(unset, i.e. `core` only)_|CSV of extra audience pack slugs to select, additive to the always-implicit `core` (`daemon.extensions.packs`)|

Also reads `$PI_STUDIO_HOME/config.json`.

---

## Protocol overview

All communication uses a **single WebSocket connection** per client.

- **Text frames** carry JSON envelopes discriminated by `type`:
  - `hello` (Client→Server, first frame, handshake)
  - `status` (Server→Client, `server_info` payload after hello — carries `serverId`, feature flags,
    and `homeDir`, the daemon host's own home directory)
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
  at the point of use is the established convention for this family. `terminals_update`
  (`packages/server/src/terminal/terminal-rpc.ts`) is a variant of the same convention with no
  subscribe RPC at all: the daemon broadcasts it to **every** active session unconditionally on
  five terminal lifecycle events (create/rename/kill/self-exit/`start_workspace_script`,
  sprint-053/task-003), and a client just listens (`packages/web-client`'s
  `use-terminal-exit-watch.ts`) rather than subscribing per path.
- **`provider_auth_*`** (sprint-055) is the one RPC family that both gets real `messages.ts` request/
  response schemas AND has a passthrough-only push: the five `provider_auth_list/login/respond/
  cancel/logout` request/response pairs are real, durable, multi-client RPC schemas, while the
  per-flow progress push (`provider_auth_flow_event` — prompts, `auth_url`/`device_code` info,
  terminal `done`) rides the same `sessionMessageBaseSchema` passthrough fallback as
  `checkout_status_update`/`file_changed` above. Lets a client without CLI shell access (browser,
  relay-remote) drive the same Pi login flow `pi-studio auth login` drives locally
  (`packages/cli/AGENTS.md`'s `auth` group) — the daemon now runs Pi's `ModelRuntime` auth engine
  in-process too, lazily (only once the first `provider_auth_*` RPC arrives), writing Pi's
  `auth.json` on the **daemon host** at the same path a daemon-spawned `pi --mode rpc` agent reads
  (`packages/server/AGENTS.md`'s "Provider auth" subsystem section). **Shipped, not just
  wire-capable**: `web-client`'s Settings dialog (gear at `ConnectionBar`'s top-right → Model
  Providers, sprint-065, `packages/web-client/AGENTS.md`'s Provider auth invariants) is the
  concrete browser client for this family — live-verified end to end including over the relay
  transport (task-007): a credential entered in the browser lands in the exact `auth.json` a
  daemon-spawned `pi --mode rpc` child reads, with no secret leaking into any log, frame beyond its
  own `provider_auth_respond_request`, `localStorage`, or the DOM.
- **`agent_ui_*`** (sprint-066, `swe/features/extension-ui-rpc.md`) bridges Pi's generic extension
  UI protocol (`docs/rpc.md` § Extension UI Protocol) onto the daemon: **every** extension dialog
  (`select`/`confirm`/`input`/`editor`) and retained surface (`setStatus`/`setWidget`/`setTitle`)
  is forwarded as an opaque `agent_ui_request` broadcast — the daemon never interprets `payload`,
  all Pi-specific semantics (surface-key namespacing, clear-by-omission, dialog-vs-fire-and-forget)
  live entirely in the Pi provider adapter. Unlike `provider_auth_*` above, this family is a real
  **`sessionMessageSchema` union member**, not a passthrough push — six schemas
  (`agentUiRequestSchema`, `agentUiResolvedSchema`, `agentUiRespondRequestSchema`/`-ResponseSchema`,
  `agentUiListRequestSchema`/`-ResponseSchema`) plus the `extensionUi` server feature flag
  (`packages/protocol/AGENTS.md`). Wire ids are always **daemon-minted** (a fresh UUID per
  emission), never the provider's own request id — the one field a client must never source from
  Pi's own protocol. Two lifecycle rules invert the family's nearest neighbours on purpose: a
  client **disconnecting** never cancels a pending dialog (opposite of `provider_auth_*`), and
  **interrupting** an agent touches nothing (opposite of tool-call permissions) — dialogs and
  surfaces are agent-lifetime state, swept only on archive/delete/respawn
  (`packages/server/AGENTS.md`'s "Extension UI" subsystem section). **Sprint-066 shipped only the
  daemon side**; sprint-067 gave `packages/client` a consumer — `PiStudioClient`'s five-member
  facade surface, a pure reducer/controller (`agent-ui-state.ts`/`agent-ui-controller.ts`), proven
  end to end against both a real dev daemon and a real `pi --mode rpc` process
  (`packages/client/AGENTS.md`'s Extension UI sections). **Sprint-068 gave `web-client` a renderer**
  for the four dialog kinds (`select`/`confirm`/`input`/`editor`, plus an unrecognised-method
  fallback) — every lifecycle state (pending, in-flight, resolved, non-answerable, multiple at
  once, recovered-after-reload) and full keyboard/focus ownership, composed inline into the chat
  transcript (`packages/web-client/AGENTS.md`'s "Extension UI dialogs" invariant). **Sprint-069
  gave `web-client` discoverability and transients** — § 08's attention signals on four surfaces
  (session row, collapsed workspace header, pane tab strip, plus an `aria-live` screen-reader
  announcement region) so a pending dialog raised anywhere is no longer invisible outside its own
  transcript, and § 11's two fire-and-forget effects (`notify` toasts via a new app-wide toast
  host, and `set_editor_text` composer replacement) (`packages/web-client/AGENTS.md`'s "Toast
  host", "Both transient effects are now wired", and "Announcements" invariants). **Still
  unrendered**: the retained surfaces (`setStatus`/`setWidget`/`setTitle`, § 09/§ 10) — a later
  sprint's scope (070 became the thinking-level selector), not yet wired to anything.
- **`agent_set_thinking` / `agent_thinking_levels`** (sprint-070, `swe/features/
  thinking-level-selector.md`) is the thinking-level RPC pair: real `messages.ts` schemas,
  registered by `slash-command-operations.ts` in both bootstraps, advertised via the
  `thinkingLevels` server feature flag. Set mirrors `handleSetModel`'s two-branch shape (deferred
  draft → pin `config.thinkingOptionId` + broadcast; live session → apply, then answer/persist/
  broadcast the EFFECTIVE level the provider re-reads from Pi `get_state`, since Pi clamps
  silently); list is live-sessions-only (`requireSession`) because drafts answer from the model
  catalogue client-side. The daemon-side persistence chain (replay order model-then-thinking,
  clamp write-back on every model change) is task-003. **Task-005 shipped the composer
  consumer**: `web-client`'s `ThinkingMenu` (brain-icon picker in `.toolbarRight`, immediately
  after `ModelMenu`) — see `packages/web-client/AGENTS.md`'s "Thinking-level selector" invariant.

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
TUI. A remote client without shell access reaches the same underlying Pi auth engine over the
WebSocket instead — the `provider_auth_*` RPC family (§ Protocol overview above,
`packages/server/AGENTS.md`'s "Provider auth" subsystem section); both paths write to the same
`auth.json`/`models.json` a daemon-spawned `pi --mode rpc` process reads (`resolvePiAuthPaths`).

---

## Persistence layout (`$PI_STUDIO_HOME/`)

```
config.json           Daemon config (password hash, provider overrides, relay, service proxy, …) — written 0600
pi-studio.pid         PID lock (prevents duplicate daemons)
server-id             Stable server identity (plain UUID via randomUUID()), unless PI_STUDIO_SERVER_ID is set
daemon-keypair.json   Persistent Curve25519 keypair (pairing / outbound relay E2EE) — written 0600;
                       replace via `pi-studio daemon rotate-key` (revokes all pairing links)
extensions-state.json Preinstalled-extensions sync bookkeeping: per-pi-home offered/failures/
                       lastSync (features/preinstalled-extensions.md § State file)
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
7. **`~` in a `cwd`/path is expanded server-side** to the daemon host's home directory before
   passing to the agent or touching the filesystem — one helper,
   `packages/server/src/files/resolve-path.ts`'s `expandHome`, used by every file RPC (including the
   file explorer) and by agent spawn. The client half of the same rule: a client MUST take the home
   directory from `server_info.homeDir` and never derive one locally (a browser on macOS may be
   driving a Linux daemon, and vice versa); an absent `homeDir` means "leave the tilde alone", not
   "guess".
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
