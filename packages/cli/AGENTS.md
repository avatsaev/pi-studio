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

  web-commands.ts        `web` command — serve the prebuilt web-client SPA as a static site.
  web-commands.test.ts
  web-server.ts           Minimal static file server (SPA fallback) rooted at web-client's dist/web.
  web-server.test.ts

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
| `--json` | Render output as JSON instead of a table |

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

`formatStreamEvent(event)` — renders an `AgentStreamEvent` as a single human-readable line.

Provider spec: `--provider pi/<model>` is parsed by `parseProviderModel()`:
- `pi/claude-3-5-sonnet` → `{ provider: "pi", model: "claude-3-5-sonnet" }`
- `mock` → `{ provider: "mock" }`
- bare `pi` → `{ provider: "pi" }`

### `daemon` group (`daemon-commands.ts`)

| Command | Description |
|---------|-------------|
| `daemon start` | Spawn a local daemon (if not already running), print pairing QR |
| `daemon stop` | Send SIGTERM to the local daemon |
| `daemon status` | Print health + PID |
| `daemon set-password <pw>` | Bcrypt-hash the password into `$PI_STUDIO_HOME/config.json` |
| `daemon pair` | Print the pairing URL / QR for an already-running daemon |

`ensureLocalDaemonAndPair(ctx, opts)` — used by the bare `pi-studio` default action:
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

Covers: `terminal`, `chat`, `schedule`, `loop`, `provider`, `worktree`, `project`, and `permit`.
Each subcommand maps to the corresponding daemon RPC family.

| Subgroup | Sample commands |
|----------|----------------|
| `terminal` | `create`, `list`, `close` |
| `chat` | `create-room`, `post`, `read`, `wait` |
| `schedule` | `create`, `list`, `delete`, `trigger` |
| `loop` | `create`, `list`, `stop`, `status` |
| `provider` | `list`, `models`, `modes`, `refresh` |
| `worktree` | `create`, `list`, `delete` |
| `project` | `open`, `list` |
| `permit` | `respond` (approve/deny a pending tool-call permission) |

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

## `CliContext` and `withDaemon()`

`CliContext` bundles injectable dependencies for testability:

```ts
interface CliContext {
  sink: OutputSink;           // write() / error() (stdout/stderr abstraction)
  daemon?: DaemonRuntime;     // override for tests
  connectOverrides?: { home?: string; url?: string; password?: string };
}
```

`withDaemon(ctx, opts, fn)` — connect to the daemon (resolves URL from `--host` or default
`ws://127.0.0.1:6767`), run `fn(daemonClient)`, then disconnect. Handles `RpcError` and
connection errors with clean stderr output and non-zero exit codes.

Exit codes:
- `EXIT_OK = 0`
- `EXIT_ERROR = 1`
- Others per Commander's help/version short-circuit handling.

---

## Connection resolution

1. `--host workstation.local:6767` → `ws://workstation.local:6767`
2. `--host ws://workstation.local:6767` → used as-is
3. No `--host` → `ws://127.0.0.1:6767`
4. Password → sent as WS subprotocol bearer or query param.

`clientId` is a stable UUID stored in `$PI_STUDIO_HOME/client-id` (created on first use).
`clientType` is always `"cli"`.

---

## Pairing / QR

`buildPairingUrl(publicKey, { host })` constructs a `pi-studio://pair?…` URL encoding the
server's Ed25519 public key and connection parameters. The QR code encodes this URL so a mobile
app can scan it to set up a relay-authenticated connection.

`readDaemonPublicKey(home)` reads the keypair from `$PI_STUDIO_HOME/keypair.json`.

---

## Invariants

- **The CLI only speaks the WebSocket API.** It never imports from `@av-pi-studio/server` directly.
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
npm test -- --project packages/cli
```

Tests cover: command parsing, provider-spec parsing, stream-event formatting, daemon-control
state machine, output rendering, pairing URL construction.
