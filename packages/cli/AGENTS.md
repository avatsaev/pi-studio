# `@av-pi-studio/cli` — AGENTS.md

`pi-studio` terminal client and local daemon lifecycle controller.
Built with Commander; talks the daemon WebSocket protocol directly.

---

## Binary

```
bin: pi-studio  →  dist/cli.js
```

After `npm run build`, invoke via:
```bash
node packages/cli/dist/cli.js [options] [command] [args]
```

Or `npm link` inside `packages/cli` to expose `pi-studio` globally on `PATH`.

---

## Source layout

```
src/
  cli.ts                 Entrypoint — parse argv, call run(), exit with code.
  program.ts             buildProgram() — root Commander program, global options, default action.
  cli-core.ts            CliContext, GlobalOptions, withDaemon() helper, exit codes.
  connection.ts          parseHost() — parse "host:port" or bare host strings.
  client-id.ts           Stable per-machine client-id storage + resolveHome().
  output.ts              renderTable(), renderObject(), renderJson() — table/JSON output helpers.
  pairing.ts             buildPairingUrl() + readDaemonPublicKey() — relay pairing URL construction.
  qr.ts                  renderQrToTerminal() — QR code string via the `qrcode` library.

  agent-commands.ts      Agent command group (run/ls/attach/send/stop/wait/timeline/…).
  agent-commands.test.ts

  daemon-commands.ts     Daemon command group (start/stop/status/set-password/pair).
  daemon-commands.test.ts

  daemon-control.ts      DaemonRuntime — probe/start/stop/waitForDaemon (spawns server process).
  feature-commands.ts    Feature command group (terminal/chat/schedule/loop/provider/worktree/…).
  feature-commands.test.ts

  relay-commands.ts      `relay` command group (start/stop/status) — self-hosted relay-server lifecycle.
  relay-commands.test.ts
  relay-control.ts        RelayRuntime — probe/start/stop/waitForRelay (spawns relay process); mirrors daemon-control.ts.

  web-commands.ts        `web` command — serve the prebuilt web-client SPA as a static site.
  web-commands.test.ts
  web-server.ts           Minimal static file server (SPA fallback) rooted at web-client's dist/web.
  web-server.test.ts

  update-commands.ts     Top-level `update` command — self-update the globally installed CLI.
  update-commands.test.ts
  update-control.ts      UpdateRuntime — getLatestVersion/installGlobal (shells out to `npm view`/
                          `npm install -g`); compareVersions() (plain x.y.z numeric compare, no
                          semver deps — this monorepo only ever publishes major.minor.patch).
  update-control.test.ts

  program.test.ts
  cli-core.test.ts
  index.ts               Public barrel (for library consumers).
```

---

## Global options

Registered on the root Commander program:

| Flag | Description |
|------|-------------|
| `-H, --host <host>` | Daemon/host target (e.g. `workstation.local:6767` or `ws://…`) |
| `--password <password>` | Password for password-protected daemons |
| `--home <dir>` | Override `$PI_STUDIO_HOME` (client-id store) |
| `--pi-home <dir>` | Override `$PI_STUDIO_PI_HOME`, forwarded to a locally-spawned daemon (`daemon start`/bare `pi-studio`/`onboard`) — redirects the bundled Pi CLI's own `.pi` config dir |
| `--json` | Render output as JSON instead of a table |
| `-v, --version` | Print the CLI's version (`@av-pi-studio/cli`'s own `package.json`, read via `createRequire` at startup — not hardcoded) and exit 0 |

Default action (no subcommand):
- `pi-studio <path>` → `open_project` on the daemon at that path.
- `pi-studio` (bare) → ensure a local daemon is running, then print the pairing QR code.

---

## Command tree

### `agent` group (`agent-commands.ts`)

| Command | RPC | Description |
|---------|-----|-------------|
| `run --provider pi/<model> "prompt"` | `create_agent_request` | Create an agent and run first turn |
| `ls` | `list_agents_request` | List all agents |
| `attach <agentId>` | subscribe `agent_stream` | Stream live events from an agent |
| `send <agentId> "prompt"` | `send_agent_prompt` | Send a follow-up prompt |
| `stop <agentId>` | `interrupt_agent` | Interrupt the current turn |
| `wait <agentId>` | `wait_for_agent` | Block until idle/closed |
| `timeline <agentId>` | `fetch_agent_timeline_request` | Print paged timeline history |
| `inspect <agentId>` | `inspect_agent_request` | Print agent record |
| `archive <agentId>` | `archive_agent` | Soft-delete |
| `delete <agentId>` | `delete_agent` | Hard delete |
| `update <agentId>` | `update_agent` | Update model/mode/features/title/labels |
| `resume <agentId>` | `resume_agent` | Resume a closed session |
| `import --provider pi --cwd /path --handle <h>` | `import_agent_session` | Import a native session |
| `session <agentId>` | `agent_session_stats_request` | Session stats (tokens/cost/context usage) — `/session` |
| `compact <agentId> [-i <text>]` | `agent_compact_request` | Manually compact context — `/compact` |
| `new-session <agentId>` | `agent_new_session_request` | Start a fresh session in place — `/new` |
| `resume-session <agentId> -p <path>` | `agent_switch_session_request` | Load a different session file in place — `/resume` |
| `fork <agentId> -e <entryId>` | `agent_fork_request` | Fork a new branch from a previous message — `/fork` |
| `fork-messages <agentId>` | `agent_fork_messages_request` | List messages available to fork from |
| `clone <agentId>` | `agent_clone_request` | Duplicate the session at the current position — `/clone` |
| `name <agentId> <name>` | `agent_set_session_name_request` | Set the session display name — `/name` |
| `export <agentId> [-o <path>]` | `agent_export_html_request` | Export the session to an HTML file — `/export` |
| `model <agentId> --provider <p> --model <m>` | `agent_set_model_request` | Switch to a specific provider model — `/model` |
| `cycle-model <agentId>` | `agent_cycle_model_request` | Cycle to the next available model — `/model` |
| `last-message <agentId>` | `agent_last_assistant_text_request` | Print the last assistant message — `/copy` |

`formatStreamEvent(event)` — renders an `AgentStreamEvent` as a single human-readable line.

`session` through `last-message` (sprint-037) are CLI equivalents of Pi built-in slash commands
that have a real Pi RPC equivalent (`/session`, `/compact`, `/new`, `/resume`, `/fork`, `/clone`,
`/name`, `/export`, `/model`, `/copy`). Built-ins with no RPC equivalent (`/settings`, `/hotkeys`,
`/changelog`, `/login`, `/logout`, `/reload`, `/scoped-models`, `/trust`, `/share`, `/quit`) are
TUI-only per Pi's own RPC docs and have no CLI command here — see `packages/server/AGENTS.md`'s
Agent subsystem section for the full rationale.

Provider spec: `--provider pi/<model>` is parsed by `parseProviderModel()`:
- `pi/claude-3-5-sonnet` → `{ provider: "pi", model: "claude-3-5-sonnet" }`
- `mock` → `{ provider: "mock" }`
- bare `pi` → `{ provider: "pi" }`

### `daemon` group (`daemon-commands.ts`)

| Command | Description |
|---------|-------------|
| `daemon start` | Spawn a local daemon (if not already running), print pairing QR |
| `daemon stop` | Send SIGTERM to the local daemon |
| `daemon restart` | Stop then start the local daemon |
| `daemon status` | Print health + PID |
| `daemon set-password <pw>` | Bcrypt-hash the password into `$PI_STUDIO_HOME/config.json` |
| `daemon pair` | Print the pairing URL / QR for an already-running daemon |
| `onboard` (top-level, not under `daemon`) | Alias for `daemon start`'s behavior — start a local daemon if needed and show the pairing QR |

`ensureLocalDaemonAndPair(ctx, opts)` — shared by the bare `pi-studio` default action, `daemon
start`, and `onboard`:
1. Probe `host:port` with `DaemonRuntime.probe()`.
2. If not running: call `DaemonRuntime.start({ home, listen })`.
3. Wait up to N seconds for `GET /api/health` to return 200.
4. Print pairing QR via `buildPairingUrl()` + `renderQrToTerminal()`.

`DaemonRuntime` (`daemon-control.ts`):
- `probe(host, port)` — HTTP GET `/api/health`, returns true if 200.
- `start(opts)` — spawn `node <server>/dist/daemon/main.js` as a detached child.
- `stop(home)` — read PID from `pi-studio.pid`, send SIGTERM.
- `status(home)` — read PID and probe health.
- `waitForDaemon(runtime, host, port, opts)` — poll health until up or timeout.

### `feature` group (`feature-commands.ts`)

`registerFeatureCommands` registers `chat`, `terminal`, `loop`, `schedule`, `permit`, `provider`,
and `worktree` as sibling top-level command groups (no `feature` wrapper), plus a top-level
`open <path>` command. Each subcommand maps to a canonical RPC name in `FEATURE_RPC`; several are
flagged `TODO(verify)` in source for wire names not yet confirmed against the real daemon.

| Group | Commands | RPC |
|-------|----------|-----|
| `chat` | `create <name> [--purpose]`, `ls`, `inspect <roomId>`, `post <roomId> <message> [--from]`, `read <roomId> [-n]`, `wait <roomId>`, `delete <roomId>` | `chat_create_request`, `chat_list_request`, `chat_inspect_request`, `chat_post_request`, `chat_read_request`, `chat_wait_request`, `chat_delete_request` |
| `terminal` | `ls`, `create [--workspace] [--cwd]`, `capture <slot>`, `send-keys <slot> <data>`, `kill <slot>` | `list_terminals_request`, `create_terminal_request`, `capture_terminal_request`, `terminal_input`, `kill_terminal_request` |
| `loop` | `run <prompt> [--max]`, `ls`, `inspect <loopId>`, `logs <loopId>`, `stop <loopId>` | `loop_run_request`, `loop_list_request`, `loop_inspect_request`, `loop_logs_request`, `loop_stop_request` |
| `schedule` | `create <cron> <prompt>`, `ls`, `inspect <id>`, `update <id> [--cron] [--prompt]`, `pause <id>`, `resume <id>`, `run-once <id>`, `logs <id>`, `delete <id>` | `schedule_create_request`, `schedule_list_request`, `schedule_inspect_request`, `schedule_update_request`, `schedule_pause_request`, `schedule_resume_request`, `schedule_run_once_request`, `schedule_logs_request`, `schedule_delete_request` |
| `permit` | `ls`, `allow <permissionRequestId>`, `deny <permissionRequestId>` | `list_permissions_request`, `respond_to_permission` (both allow/deny) |
| `provider` | `ls`, `models <providerId>` | `list_providers`, `list_models` |
| `worktree` | `create <name> [--workspace]`, `ls`, `archive <name>` | `create_pistudio_worktree_request`, `pistudio_worktree_list_request`, `pistudio_worktree_archive_request` |
| _(top-level)_ | `open <path>` | `open_project_request` (same path as the bare `pi-studio <path>` default action) |

### `relay` group (`relay-commands.ts`)

| Command | Description |
|---------|-------------|
| `relay start [--listen <host:port>]` | Spawn a local relay server (default `0.0.0.0:7000`), wait for health |
| `relay stop` | Send SIGTERM to the local relay |
| `relay status [--listen <host:port>]` | Print up/down for the relay at that address |

A self-hosted deployment of `@av-pi-studio/relay`'s standalone `startRelayServer()`
(`packages/relay/src/relay-server.ts` — a `ws` `WebSocketServer` wired to `RelaySessionBridge`, plus
a bare `GET /health`). Runs as its OWN managed process, entirely separate from the daemon's
lifecycle — the relay has no identity keypair, no `$PI_STUDIO_HOME` state beyond its own PID file
(`pi-studio-relay.pid`), and no per-project data; it only bridges a daemon's outbound connection
with a client's, keyed by session id (architecture/relay-e2ee.md § Purpose). Typically run on a
separate publicly-reachable host from the daemon it relays for.

`RelayRuntime` (`relay-control.ts`, mirrors `DaemonRuntime` exactly):
- `probe(host, port)` — HTTP GET `/health`, returns true if 200.
- `start(opts)` — resolve `@av-pi-studio/relay/server` via `import.meta.resolve` (same pattern
  `subprocessStarter` uses for `@av-pi-studio/server`), spawn a detached `node -e` script calling
  `startRelayServer({ host, port })`, write the child's pid to
  `$PI_STUDIO_HOME/pi-studio-relay.pid`.
- `kill(pid)` — send SIGTERM.
- `waitForRelay(runtime, host, port, opts)` — poll health until up or timeout; `runRelayStart()`
  exposes this with an injectable `sleep` for tests, exactly like `ensureLocalDaemonAndPair`'s
  `startOpts.sleep`.

The package is also directly runnable standalone (no CLI needed) via its own `bin`:
`pi-studio-relay [--listen host:port]` (or `PI_STUDIO_RELAY_LISTEN` env), e.g.
`npx @av-pi-studio/relay` on a bare VM.

---

### `web` command (`web-commands.ts`)

`pi-studio web [--web-host <host>] [--web-port <port>] [--daemon-host <host>]` — serves the
prebuilt `@av-pi-studio/web-client` SPA (`dist/web`, built by `npm run build:web -w
packages/web-client`) as a static site via a minimal `node:http` server (`web-server.ts`;
`resolveWebClientDist()` locates the installed package, `startWebServer()` serves it with SPA
fallback to `index.html` for client-side routes).

Intentionally decoupled from daemon lifecycle: `web` never probes or starts a daemon.
`--daemon-host` (falls back to the global `--host`) only pre-fills the printed URL's
`?host=<ws-url>&connect=1` query params (`buildServeUrl()`) so the browser tab auto-connects —
mirroring the POC `chat.html` quick-launch params. The command blocks until `SIGINT`/`SIGTERM`,
then closes the server and exits `EXIT_OK`.

`@av-pi-studio/web-client` is a runtime dependency of `cli` purely for its built static assets
(no JS from it is imported) — the CLI ships the SPA build so `pi-studio web` works from any
install shape (npm link, global `npm i -g`) without a separate vite/dev toolchain.

---

### `update` command (`update-commands.ts`)

`pi-studio update [--check]` — self-updates the globally installed CLI to the latest
`@av-pi-studio/cli` version published on npm, via the SAME `npm install -g` path used to install
it in the first place (README.md § Install) — shells out to the user's own `npm`, rather than
reimplementing a registry client, so it correctly respects npm config (registry mirrors, auth,
proxies) and stays in sync with whatever `npm install -g` itself does.

`--check` reports whether an update is available without installing anything (exit `EXIT_OK`
either way — "already up to date" is not a failure).

`UpdateRuntime` (`update-control.ts`):
- `getLatestVersion(pkg)` — `npm view <pkg> version`; returns `null` on any failure (registry
  unreachable, offline, etc.) rather than throwing, so `runUpdate` can render one clean error line.
- `installGlobal(pkg, version)` — `npm install -g <pkg>@<version>`; throws on failure (surfaced via
  the child's stderr, falling back to the error message).
- `compareVersions(a, b)` — plain numeric `x.y.z` compare (missing segments treat as 0), NOT a full
  semver comparator (no prerelease/build-metadata handling) — sufficient because this monorepo only
  ever publishes bare `major.minor.patch` releases (`scripts/publish.sh`'s patch-only bump).
- `CURRENT_VERSION` — this package's own `package.json` version, read via `createRequire` at
  startup (same pattern as `program.ts`'s `-v/--version`) — never hardcoded.

---

## `CliContext` and `withDaemon()`

`CliContext` bundles injectable dependencies for testability:

```ts
interface CliContext {
  connect(opts: ConnectOptions): ReturnType<typeof connectDaemon>;  // injectable in tests
  sink: OutputSink;               // write() / error() (stdout/stderr abstraction)
  rpcTimeoutMs?: number;          // default RPC timeout override
  connectOverrides?: Pick<ConnectOptions, "transport" | "clientId" | "home">;  // test hooks
  daemon?: DaemonRuntime;        // local daemon control override for tests
  relay?: RelayRuntime;          // local relay-server control override for tests
  update?: UpdateRuntime;        // self-update control override for tests
}
```

`withDaemon(ctx, opts, fn)` — connect to the daemon (resolves URL from `--host` or default
`ws://127.0.0.1:6767`), run `fn(daemonClient, ctx)`, then disconnect. Handles `RpcError` and
connection errors with clean stderr output and non-zero exit codes.

Exit codes (`cli-core.ts`):
- `EXIT_OK = 0`
- `EXIT_ERROR = 1`
- `EXIT_CONNECTION = 2`
- Others per Commander's help/version short-circuit handling.

---

## Connection resolution

1. `--host workstation.local:6767` → `ws://workstation.local:6767`
2. `--host ws://…`/`wss://…` → used as-is (`wss` ⇒ TLS)
3. `--host http://…`/`https://…` → mapped to `ws://…`/`wss://…` (`https` ⇒ TLS). The daemon is a
   single HTTP server that upgrades to WebSocket on the same port, so either scheme reaches it.
4. No `--host` → `ws://127.0.0.1:6767`
5. Password → sent as WS subprotocol bearer or query param.

`clientId` is a stable UUID stored in `$PI_STUDIO_HOME/client-id` (created on first use).
`clientType` is always `"cli"`.

---

## Pairing / QR

`buildPairingUrl(publicKeyB64, { host, relay, baseUrl })` constructs a pairing URL
(`https://app.molagent.ai/#offer=<publicKeyB64>&host=<host>` by default — `DEFAULT_PAIRING_BASE`
in `pairing.ts`, Pi-Studio's own production web-client; override via `PI_STUDIO_APP_BASE_URL`/
`config.app.baseUrl` for self-hosted deployments, which should point it at THEIR OWN web-client
origin instead) encoding the daemon's
persistent **Curve25519** public key in the URL **fragment** (never sent to the pairing web
origin), plus either a direct `host` hint OR relay-routing info (`&relay=<endpoint>
&relayTls=<0|1>`) — the two are mutually exclusive; `relay` wins when both are available.
`printPairing` (`daemon-commands.ts`) resolves which one to pass by reading `daemon.relay` from
`config.json` (`@av-pi-studio/server`'s `loadConfig`, env-overlaid): when `daemon.relay.enabled`,
it uses `publicEndpoint`/`publicUseTls` (falling back to `endpoint`/`useTls` if no separate public
address was configured) and omits `host` entirely — a relay-only daemon behind a firewall/NAT has
no reachable direct host to offer. `printPairing` also forwards `config.app.baseUrl`
(`PI_STUDIO_APP_BASE_URL` env override) as `baseUrl` — self-hosted/local deployments (e.g. the
Docker compose stack, `docker/docker-compose.yml`) should set this to their own reachable
web-client origin instead of the unreachable default. The QR/link encodes this URL so a
browser/mobile client can scan/paste it to connect directly (`web-client`'s
`connection-store.ts#connect()` detects the link via `@av-pi-studio/client`'s `parsePairingUrl` and
branches to `createRelayTransport` when it carries a relay offer).

`readDaemonPublicKey(home)` reads the keypair from `$PI_STUDIO_HOME/daemon-keypair.json` (same file
`@av-pi-studio/server`'s `bootstrap.ts` writes/reads — `{ publicKeyB64, secretKeyB64 }`).

---

## Invariants

- **The CLI process never runs daemon/relay code in-process.** It only speaks the WebSocket API to
  drive an existing daemon, and only resolves `@av-pi-studio/server`/`@av-pi-studio/relay/server`
  via `import.meta.resolve` (never `await import()`) to bake an absolute module URL into a detached
  `node -e` subprocess it spawns — see `daemon-control.ts`'s `subprocessStarter` and
  `relay-control.ts`'s `subprocessRelayStarter`.
- **`withDaemon` handles all connection lifecycle.** Individual commands don't call
  `connect`/`disconnect` manually.
- **`--json` flag** must be respected by all commands that produce structured output (use
  `renderJson()` vs `renderTable()`).
- **Commander `exitOverride()`** is set on the root program so `process.exit()` is never called
  inside the library; the caller (cli.ts) manages the exit code.
- **Tests inject `CliContext`** with a stub sink and mock `DaemonRuntime`; no real daemon is
  spawned.

---

## Testing

```bash
npx vitest run packages/cli
```

Tests cover: command parsing, provider-spec parsing, stream-event formatting, daemon-control
state machine, output rendering, pairing URL construction.
