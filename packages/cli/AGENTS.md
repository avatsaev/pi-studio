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

  auth-runtime.ts        AuthRuntime seam — resolvePiAuthPaths() (daemon-parity `<piHome>/agent/auth.json`),
                          lazy `ModelRuntime` construction, provider listing/checkAuth/login/logout.
  auth-runtime.test.ts

  auth-interaction.ts    Terminal `AuthInteraction`: `@inquirer/prompts` (masked secret / text /
                          arrow-key select, upgrading to type-to-filter search above 8 options /
                          manual-code), notify rendering (info/auth_url/device_code/progress) with
                          QR, serialized through a queue that prompts await so a QR never lands
                          mid-prompt, prefilled `createApiKeyInteraction()` for headless
                          `--api-key`, flow-wide + per-prompt abort (inquirer's `ExitPromptError`
                          for Ctrl+C during a live prompt).
  auth-interaction.test.ts

  auth-commands.ts       `auth` command group (login/status/logout) — local, daemon-free.
  auth-commands.test.ts

  agent-commands.ts      Agent command group (run/ls/attach/send/stop/wait/logs/…).
  agent-commands.test.ts

  daemon-commands.ts     Daemon command group (start/stop/status/set-password/pair/rotate-key).
  daemon-commands.test.ts

  extensions-commands.ts `extensions` command group (list/select/sync) + daemon-free `list
                          --local` mode.
  extensions-commands.test.ts

  daemon-control.ts      DaemonRuntime — probe/start/stop/waitForDaemon (spawns server process).
  feature-commands.ts    Feature command group (terminal/chat/schedule/loop/provider/worktree/…).
  feature-commands.test.ts

  relay-commands.ts      `relay` command group (start/stop/status) — self-hosted relay-server lifecycle.
  relay-commands.test.ts
  relay-control.ts        RelayRuntime — probe/start/stop/waitForRelay (spawns relay process); mirrors daemon-control.ts.

  pi-commands.ts         `pi` pass-through command — proxies argv/exit-code to the embedded Pi CLI.
  pi-commands.test.ts

  ui-commands.ts          `ui` command — serve the prebuilt web-client SPA as a static site.
  ui-commands.test.ts
  web-server.ts           Minimal static file server (SPA fallback) rooted at web-client's dist/web.
  web-server.test.ts

  update-commands.ts     Top-level `update` command — self-update the globally installed CLI.
  update-commands.test.ts
  update-control.ts      UpdateRuntime — getLatestVersion/installGlobal (shells out to `npm view`/
                          `npm install -g`, self-healing npm's ENOTEMPTY stale-staging-dir rename
                          bug — see § `update` command below); compareVersions() (plain x.y.z
                          numeric compare, no semver deps — this monorepo only ever publishes
                          major.minor.patch).
  update-control.test.ts

  promise-with-resolvers.d.ts   Promise.withResolvers() ambient decl (lib predates ES2024;
                                 mirrors web-client/src/lib/promise-with-resolvers.d.ts).

  program.test.ts
  cli-core.test.ts
  index.ts               Public barrel (for library consumers).
```

---

## Global options

Registered on the root Commander program:

| Flag                    | Description                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-H, --host <host>`     | Daemon/host target (e.g. `workstation.local:6767` or `ws://…`)                                                                                                                                                                                                                                    |
| `--password <password>` | Password for password-protected daemons                                                                                                                                                                                                                                                           |
| `--home <dir>`          | Override `$PI_STUDIO_HOME` (client-id store)                                                                                                                                                                                                                                                      |
| `--pi-home <dir>`       | Override `$PI_STUDIO_PI_HOME` — forwarded to a locally-spawned daemon (`daemon start`/bare `pi-studio`/`onboard`) and to `pi-studio pi`; also selects the `<piHome>/agent/auth.json` the `auth` group reads/writes (`resolvePiAuthPaths()`) — redirects the bundled Pi CLI's own `.pi` config dir |
| `--json`                | Render output as JSON instead of a table                                                                                                                                                                                                                                                          |
| `-v, --version`         | Print the CLI's version (`@av-pi-studio/cli`'s own `package.json`, read via `createRequire` at startup — not hardcoded) and exit 0                                                                                                                                                                |

Default action (no subcommand):

- `pi-studio <path>` → `open_project` on the daemon at that path.
- `pi-studio` (bare) → ensure a local daemon is running, then print the pairing QR code.

---

## Command tree

### `agent` group (`agent-commands.ts`)

| Command                                      | RPC                                 | Description                                                                                              |
| -------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `run --provider pi/<model> "prompt"`         | `create_agent_request`              | Create an agent and run first turn                                                                       |
| `ls`                                         | `list_agents_request`               | List all agents                                                                                          |
| `attach <agentId>`                           | subscribe `agent_stream`            | Stream live events from an agent                                                                         |
| `send <agentId> "prompt"`                    | `send_agent_prompt`                 | Send a follow-up prompt                                                                                  |
| `stop <agentId>`                             | `interrupt_agent`                   | Interrupt the current turn                                                                               |
| `steer <agentId> "message"`                  | `steer_agent_request`               | Steer a running turn (after current tool calls)                                                          |
| `follow-up <agentId> "message"`              | `follow_up_agent_request`           | Queue a message for after the agent stops                                                                |
| `wait <agentId>`                             | `wait_for_agent`                    | Block until idle/closed                                                                                  |
| `logs <agentId> [-n <limit>]`                | `fetch_agent_timeline_request`      | Print paged timeline history                                                                             |
| `inspect <agentId>`                          | `inspect_agent_request`             | Print agent record                                                                                       |
| `archive <agentId>`                          | `archive_agent`                     | Soft-delete                                                                                              |
| `delete <agentId>`                           | `delete_agent`                      | Hard delete                                                                                              |
| `update <agentId>`                           | `update_agent`                      | Update model/mode/features/title/labels                                                                  |
| `reload <agentId>`                           | `resume_agent`                      | Resume/reload a closed session                                                                           |
| `import <sessionRef>`                        | `import_agent_session`              | Import a provider-native session by its handle                                                           |
| `session <agentId>`                          | `agent_session_stats_request`       | Session stats (tokens/cost/context usage) — `/session`                                                   |
| `compact <agentId> [-i <text>]`              | `agent_compact_request`             | Manually compact context — `/compact`                                                                    |
| `new-session <agentId>`                      | `agent_new_session_request`         | Start a fresh session in place — `/new`                                                                  |
| `resume-session <agentId> -p <path>`         | `agent_switch_session_request`      | Load a different session file in place — `/resume`                                                       |
| `fork <agentId> -e <entryId>`                | `agent_fork_request`                | Fork a new branch from a previous message — `/fork`                                                      |
| `fork-messages <agentId>`                    | `agent_fork_messages_request`       | List messages available to fork from                                                                     |
| `clone <agentId>`                            | `agent_clone_request`               | Duplicate the session at the current position — `/clone`                                                 |
| `name <agentId> <name>`                      | `agent_set_session_name_request`    | Set the session display name — `/name`                                                                   |
| `export <agentId> [-o <path>]`               | `agent_export_html_request`         | Export the session to an HTML file — `/export`                                                           |
| `model <agentId> --provider <p> --model <m>` | `agent_set_model_request`           | Switch to a specific provider model — `/model`                                                           |
| `cycle-model <agentId>`                      | `agent_cycle_model_request`         | Cycle to the next available model — `/model`                                                             |
| `last-message <agentId>`                     | `agent_last_assistant_text_request` | Print the last assistant message — `/copy`                                                               |
| `commands <agentId>`                         | `agent_list_commands_request`       | List discoverable commands: extensions, prompt templates, skills (sprint-040, no Pi built-in equivalent) |

`formatStreamEvent(event)` — renders an `AgentStreamEvent` as a single human-readable line, or `""`
for events with nothing to show (textless `assistant_message.final` block-close markers, empty
deltas). `logs` and `attach` skip empty renders rather than printing a blank line; `--json` mode
dumps every event verbatim, markers included.

`session` through `last-message` (sprint-037) are CLI equivalents of Pi built-in slash commands
that have a real Pi RPC equivalent (`/session`, `/compact`, `/new`, `/resume`, `/fork`, `/clone`,
`/name`, `/export`, `/model`, `/copy`). Built-ins with no RPC equivalent (`/settings`, `/hotkeys`,
`/changelog`, `/login`, `/logout`, `/reload`, `/scoped-models`, `/trust`, `/share`, `/quit`) are
TUI-only per Pi's own RPC docs and have no CLI command here — see `packages/server/AGENTS.md`'s
Agent subsystem section for the full rationale. (Naming note: Pi's own TUI-only `/reload` in that
excluded list is unrelated to this CLI's `reload <agentId>` command above — the latter is a
`resume_agent` RPC call, named for reloading a closed _daemon_ session, not Pi's
extensions/skills/keybindings reload.)

Provider spec: `--provider pi/<model>` is parsed by `parseProviderModel()`:

- `pi/claude-3-5-sonnet` → `{ provider: "pi", model: "claude-3-5-sonnet" }`
- `mock` → `{ provider: "mock" }`
- bare `pi` → `{ provider: "pi" }`

### `auth` group (`auth-commands.ts`)

| Command                                                           | Description                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth login [provider] [--type api_key\|oauth] [--api-key <key>]` | Log in to a model provider — interactive picker/prompts, or headless with `--api-key` (requires an explicit `provider`, implies `--type api_key`) |
| `auth status [--json]`                                            | Show which providers are configured, how (`api key`\|`oauth`\|`not configured`\|`unknown`), and from where (stored credential / ambient env var)  |
| `auth logout <provider>`                                          | Remove a stored provider credential (idempotent; notes when an ambient env var still configures it)                                               |

**Local and daemon-free** — unlike every other group above, `auth` never opens a WebSocket. It
talks directly to Pi's own auth store (`<piHome>/agent/auth.json`, see `--pi-home` above) through
`auth-runtime.ts`'s `AuthRuntime` seam, which lazily constructs `@earendil-works/pi-coding-agent`'s
`ModelRuntime` — Pi's real login/logout/checkAuth engine, the same one the daemon's spawned
`pi --mode rpc` processes read credentials from. This is a different mechanism from Pi's own
TUI-only `/login`/`/logout` slash commands noted under the `agent` group above (those run inside an
already-spawned agent session and have no RPC equivalent); `auth login` instead writes directly to
the file both the CLI and every future agent spawn read, before any agent needs to exist.

### `daemon` group (`daemon-commands.ts`)

| Command                                   | Description                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `daemon start`                            | Spawn a local daemon (if not already running), persist any `PI_STUDIO_RELAY_*` env vars into `config.json`, print pairing QR |
| `daemon stop`                             | Send SIGTERM to the local daemon                                                                                             |
| `daemon restart`                          | Stop then start the local daemon                                                                                             |
| `daemon status`                           | Print health + PID                                                                                                           |
| `daemon set-password <pw>`                | Bcrypt-hash the password into `$PI_STUDIO_HOME/config.json`                                                                  |
| `daemon pair`                             | Print the pairing URL / QR for an already-running daemon                                                                     |
| `daemon rotate-key`                       | Mint a fresh pairing keypair (stop → delete key → restart → print new QR); revokes every previously-issued pairing link |
| `onboard` (top-level, not under `daemon`) | Alias for `daemon start`'s behavior — start a local daemon if needed and show the pairing QR                                 |

`ensureLocalDaemonAndPair(ctx, opts)` — shared by the bare `pi-studio` default action, `daemon
start`, and `onboard`:

1. `persistRelayEnvOverrides(home)` — see below.
2. Probe `host:port` with `DaemonRuntime.probe()`.
3. If not running: call `DaemonRuntime.start({ home, listen })`.
4. Wait up to N seconds for `GET /api/health` to return 200.
5. Print pairing QR via `buildPairingUrl()` + `renderQrToTerminal()`.

`DaemonRuntime` (`daemon-control.ts`):

- `probe(host, port)` — HTTP GET `/api/health`, returns true if 200.
- `start(opts)` — spawn `node <server>/dist/daemon/main.js` as a detached child.
- `stop(home)` — read PID from `pi-studio.pid`, send SIGTERM.
- `status(home)` — read PID and probe health.
- `waitForDaemon(runtime, host, port, opts)` — poll health until up or timeout.

`persistRelayEnvOverrides(home, env = process.env)` (`daemon-control.ts`) — writes any
`PI_STUDIO_RELAY_*` env vars present in `env` into `config.json`'s `daemon.relay` (creating the
file/home if missing), so a `daemon start`/`restart`/`onboard` run WITH relay env vars set makes
the daemon remember them on a LATER run WITHOUT those env vars. Needed because
`@av-pi-studio/server`'s `loadConfig`/`overlayEnv` only overlays env vars onto the in-memory config
for that one process — it never writes back to disk, so without this the relay config a `daemon
start` was invoked with was otherwise silently forgotten as soon as the shell/env that set it was
gone. No-ops (never touches or creates `config.json`) when no `PI_STUDIO_RELAY_*` env var is set, so
a plain `daemon start` can't force a config file into existence or clobber an already-persisted
relay config. Mirrors `setDaemonPassword`'s read-merge-write shape; only the fields whose env var is
actually present get overwritten.

Both `setDaemonPassword` and `persistRelayEnvOverrides` write `config.json` through a shared
`writeConfigFile` helper that enforces owner-only `0600` (the file can carry the daemon password
hash) — including an explicit `chmod` to re-tighten configs written before this was enforced.

`rotateDaemonKeypair(home)` (`daemon-control.ts`) — deletes `$PI_STUDIO_HOME/daemon-keypair.json`;
returns whether a key was actually removed. Credential revocation, not housekeeping: a pairing
link's `offer=` key IS the credential on a relay-routed connection (`connection-store.ts` ignores
the password field in that mode), and the relay rendezvous id is
`deriveRelaySessionId(publicKey)` — deterministic for the life of the key. A leaked pairing
link/QR therefore grants access forever until the key behind it is replaced, which is what
`daemon rotate-key` exists for. The command stops the daemon FIRST (a live daemon holds the old key
in memory and keeps answering on the old relay session id, so deleting the file under it would
revoke nothing), deletes the key, then goes through `ensureLocalDaemonAndPair` — the daemon mints a
fresh identity on boot (`server/src/daemon/bootstrap.ts#resolveDaemonKeypair` regenerates when the
file is missing/unreadable) and the new QR is printed. Deliberately touches nothing in
`config.json`: the password hash and relay config survive a rotation.

### `extensions` group (`extensions-commands.ts`)

| Command                          | RPC                                                          | Description                                                                                     |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `extensions list`                 | `extension_packs_list_request`                                | Table of curated packs/entries/statuses (`--json` for the raw payload); exit `0` always          |
| `extensions list --local`         | _(none — no daemon)_                                          | Same table, computed in-process against `$PI_STUDIO_HOME`/`--pi-home`; read-only, no daemon      |
| `extensions select [packs...]`    | `extension_packs_set_request` (with `packs`)                  | Replace the selection (`core` always implicit), then sync                                        |
| `extensions sync`                 | `extension_packs_set_request` (no `packs` key)                | Sync now without changing the selection — the ungated manual path, works with `autoSync: false`  |

`select`/`sync` use `client.request(type, params, EXTENSIONS_SYNC_TIMEOUT_MS)` directly
(`EXTENSIONS_SYNC_TIMEOUT_MS = 600_000`), **not** `runRpc` (no timeout slot) and not `withDaemon`'s
default `rpcTimeoutMs` — the response arrives only after the daemon's triggered sync completes,
which can exceed the SDK's 30 s default on a first-run install of five packages. Report rendering
(`renderSyncReport`) and exit-code mapping (`exitCodeForSetResponse`) are pure, unit-tested
functions: `ok`/`noop` ⇒ `EXIT_OK`; `partial`/`failed`/`skipped`, or a rejected `ok: false`
response, ⇒ `EXIT_ERROR` — no carve-out for "expected" failures, successful installs are always
kept and reported. A daemon not advertising `serverFeatures.extensionPacks` prints "this daemon
does not support extension packs; update the host" and exits `EXIT_ERROR` **before** sending any
request.

`extensions list --local` mirrors the `auth` group's daemon-free precedent (see Invariants below
for the module-boundary rationale): it resolves the effective pi-home through the SAME
`effectivePiHomeKey`/`loadConfig` derivation the daemon uses (never a hand-rolled `<dir>/agent`
join), then calls the identical `planSync`/`attachLastErrors` and renders through the identical
`renderExtensionsList` the daemon path calls — the wire-shape mapping (`toExtensionPackInfoList`,
`packages/server/src/extensions/wire.ts`) is shared code, not a parallel reimplementation, so the
two paths cannot drift for the same on-disk state. Requires `--pi-home <dir>` **before** the
subcommand (a root option: `pi-studio --pi-home <dir> extensions list --local`).

### `feature` group (`feature-commands.ts`)

`registerFeatureCommands` registers `chat`, `terminal`, `loop`, `schedule`, `permit`, `provider`,
and `worktree` as sibling top-level command groups (no `feature` wrapper), plus a top-level
`open <path>` command. Each subcommand maps to a canonical RPC name in `FEATURE_RPC`; several are
flagged `TODO(verify)` in source for wire names not yet confirmed against the real daemon.

| Group         | Commands                                                                                                                                                    | RPC                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`        | `create <name> [--purpose]`, `ls`, `inspect <roomId>`, `post <roomId> <message> [--from]`, `read <roomId> [-n]`, `wait <roomId>`, `delete <roomId>`         | `chat_create_request`, `chat_list_request`, `chat_inspect_request`, `chat_post_request`, `chat_read_request`, `chat_wait_request`, `chat_delete_request`                                                                                        |
| `terminal`    | `ls`, `create [--workspace] [--cwd]`, `capture <slot>`, `send-keys <slot> <data>`, `kill <slot>`                                                            | `list_terminals_request`, `create_terminal_request`, `capture_terminal_request`, `terminal_input`, `kill_terminal_request`                                                                                                                      |
| `loop`        | `run <prompt> [--max]`, `ls`, `inspect <loopId>`, `logs <loopId>`, `stop <loopId>`                                                                          | `loop_run_request`, `loop_list_request`, `loop_inspect_request`, `loop_logs_request`, `loop_stop_request`                                                                                                                                       |
| `schedule`    | `create <cron> <prompt>`, `ls`, `inspect <id>`, `update <id> [--cron] [--prompt]`, `pause <id>`, `resume <id>`, `run-once <id>`, `logs <id>`, `delete <id>` | `schedule_create_request`, `schedule_list_request`, `schedule_inspect_request`, `schedule_update_request`, `schedule_pause_request`, `schedule_resume_request`, `schedule_run_once_request`, `schedule_logs_request`, `schedule_delete_request` |
| `permit`      | `ls`, `allow <permissionRequestId>`, `deny <permissionRequestId>`                                                                                           | `list_permissions_request`, `respond_to_permission` (both allow/deny)                                                                                                                                                                           |
| `provider`    | `ls`, `models <providerId>`                                                                                                                                 | `list_providers`, `list_models`                                                                                                                                                                                                                 |
| `worktree`    | `create <name> [--workspace]`, `ls`, `archive <name>`                                                                                                       | `create_pistudio_worktree_request`, `pistudio_worktree_list_request`, `pistudio_worktree_archive_request`                                                                                                                                       |
| _(top-level)_ | `open <path>`                                                                                                                                               | `open_project_request` (same path as the bare `pi-studio <path>` default action)                                                                                                                                                                |

### `relay` group (`relay-commands.ts`)

| Command                               | Description                                                          |
| ------------------------------------- | -------------------------------------------------------------------- |
| `relay start [--listen <host:port>]`  | Spawn a local relay server (default `0.0.0.0:7000`), wait for health |
| `relay stop`                          | Send SIGTERM to the local relay                                      |
| `relay status [--listen <host:port>]` | Print up/down for the relay at that address                          |

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

### `pi` command (`pi-commands.ts`)

`pi-studio pi [args...]` — pure pass-through proxy to the embedded Pi coding-agent CLI (the exact
binary `@earendil-works/pi-coding-agent` ships and the one the daemon spawns for `pi --mode rpc`),
so `pi-studio pi ...` is a drop-in replacement for a globally-installed `pi` with zero re-implemented
flag/subcommand surface. Never touches the daemon, the wire protocol, or RPC.

- `.allowUnknownOption().passThroughOptions().allowExcessArguments().helpOption(false)` on the
  Commander subcommand — Commander must not parse, validate, or intercept any of Pi's own flags
  (`--model`, `-p`, `--session`, subcommands like `install`/`config`, …). `helpOption(false)` in
  particular lets `--help`/`-h` reach Pi's own help instead of pi-studio's (pi-studio's help for
  this command is still available via `pi-studio --help`).
- `stdio: "inherit"` — required for Pi's interactive TUI (default when run with no `-p`/`--print`),
  spinners, and prompts to behave exactly as native `pi`.
- The child's exit code is forwarded unchanged as the CLI's own exit code.

`PiRuntime` (`pi-commands.ts`, injectable via `CliContext.pi` for tests):

- `resolveBundled()` — `resolveBundledPiCli()` from `@av-pi-studio/server` (re-exported from the
  same `agent/providers/pi/rpc-transport.ts` the daemon uses to spawn `pi --mode rpc`): resolves the
  entrypoint `@earendil-works/pi-coding-agent` itself declares as `bin.pi` — read from the
  dependency's own `package.json`, not hardcoded — via `import.meta.resolve`, falling back to a
  `node_modules` walk-up and then to the two known entrypoints (`dist/bundle/cli.js`, Pi's declared
  `bin` since 0.84.4; `dist/cli.js`, its declared `bin` through 0.84.3 and still shipped). Returns
  `null` if the dependency isn't installed. Reading the declared `bin` is deliberate: Pi relocated it
  in 0.84.4, and the dependency range accepts future minors, so a hardcoded path would silently
  regress to a global `pi` on the next relocation.
- `onPath(bin)` — `resolveBinaryOnPath()` (same package): probes a bare binary on `$PATH`.
- `piProxyCommand(runtime, args)` — prefers the bundled CLI launched via `process.execPath`; falls
  back to a global `pi` on `$PATH` when the dependency is absent (mirrors the daemon's own
  `defaultPiCommand()` fallback); returns `null` when neither is found (reported as `EXIT_ERROR`).
- `piProxyEnv(opts, env)` — derives `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR` from
  `--pi-home`/`PI_STUDIO_PI_HOME` (same derivation as the server's `agent/pi-home.ts`
  `piHomeEnv()`, kept as a separate implementation here since the CLI has no daemon config context
  when run standalone), so `pi-studio pi` talks to the same Pi config tree the daemon's agents use.
- `spawn({ command, env })` — default implementation forwards signals via shared process-group
  membership and maps a signal-killed child's exit to the conventional `128 + signal` status.

---

### `ui` command (`ui-commands.ts`)

`pi-studio ui [--ui-host <host>] [--ui-port <port>] [--daemon-host <host>]` — serves the
prebuilt `@av-pi-studio/web-client` SPA (`dist/web`, built by `npm run build:web -w
packages/web-client`) as a static site via a minimal `node:http` server (`web-server.ts`;
`resolveWebClientDist()` locates the installed package, `startWebServer()` serves it with SPA
fallback to `index.html` for client-side routes).

Intentionally decoupled from daemon lifecycle: `ui` never probes or starts a daemon.
`--daemon-host` (falls back to the global `--host`) only pre-fills the printed URL's
`?host=<ws-url>&connect=1` query params (`buildServeUrl()`) so the browser tab auto-connects —
mirroring the POC `chat.html` quick-launch params. The command blocks until `SIGINT`/`SIGTERM`,
then closes the server and exits `EXIT_OK`.

`@av-pi-studio/web-client` is a runtime dependency of `cli` purely for its built static assets
(no JS from it is imported) — the CLI ships the SPA build so `pi-studio ui` works from any
install shape (npm link, global `npm i -g`) without a separate vite/dev toolchain.

---

### `update` command (`update-commands.ts`)

`pi-studio update [--check]` — self-updates the globally installed CLI to the latest
`@av-pi-studio/cli` version published on npm, via the SAME `npm install -g` path used to install
it in the first place (README.md § Install) — shells out to the user's own `npm`, rather than
reimplementing a registry client, so it correctly respects npm config (registry mirrors, auth,
proxies) and stays in sync with whatever `npm install -g` itself does. It then always also runs
`pi update --extensions` against the same embedded/global Pi CLI `pi-studio pi` proxies to
(reusing `runPiProxy` from `pi-commands.ts` verbatim — same bundled-CLI-first resolution,
`--pi-home` env derivation, and exit-code mapping), bringing already-installed curated extensions
(deliberately unpinned — `packages/server/AGENTS.md`'s extensions section) up to their latest
published version. This closes the loop the unpinned-install design left open: Pi-Studio's own
sync engine never updates an already-installed extension's version (that's the user's job via
`pi update`), so a single `pi-studio update` is the one command that updates both the CLI and
every extension version — the extensions step runs unconditionally whenever the CLI step isn't
skipped by `--check`, independent of whether the CLI itself had a new version, since extensions
publish on their own schedule.

`--check` reports whether a CLI update is available without installing anything or touching pi
extensions (exit `EXIT_OK` either way — "already up to date" is not a failure). It only checks the
CLI package; there is no dry-run equivalent for the extensions step.

`UpdateRuntime` (`update-control.ts`):

- `getLatestVersion(pkg)` — `npm view <pkg> version`; returns `null` on any failure (registry
  unreachable, offline, etc.) rather than throwing, so `runUpdate` can render one clean error line.
- `installGlobal(pkg, version)` — `npm install -g <pkg>@<version>`; throws on failure (surfaced via
  the child's stderr, falling back to the error message). Self-heals npm's own `ENOTEMPTY`
  rename-collision bug: npm's arborist stages each install swap under a directory name hashed
  from the install path (`@npmcli/arborist`'s `retire-path.js`) and only deletes it after a
  _successful_ install, so an interrupted/killed/concurrent prior update leaves that exact
  directory behind non-empty — colliding with every subsequent install forever until removed by
  hand. `installWithStaleStagingRetry` detects that specific error via `staleStagingDirFrom`,
  `rm -rf`s the directory npm itself reported, and retries (bounded, default 3 attempts) before
  giving up and rethrowing.
- `compareVersions(a, b)` — plain numeric `x.y.z` compare (missing segments treat as 0), NOT a full
  semver comparator (no prerelease/build-metadata handling) — sufficient because this monorepo only
  ever publishes bare `major.minor.patch` releases (`scripts/publish.sh`'s patch-only bump).
- `CURRENT_VERSION` — this package's own `package.json` version, read via `createRequire` at
  startup (same pattern as `program.ts`'s `-v/--version`) — never hardcoded.

`runUpdate`'s exit code: the CLI self-update step's outcome wins over the extensions step's when
both are attempted (a failed npm install is reported even if `pi update --extensions` happened to
succeed afterward); when the CLI step succeeds or is a no-op ("already up to date"), the
extensions step's exit code (e.g. `EXIT_ERROR` if no embedded/global Pi CLI is resolvable, or Pi's
own `update --extensions` exits nonzero) is surfaced instead.

---

## `CliContext` and `withDaemon()`

`CliContext` bundles injectable dependencies for testability:

```ts
interface CliContext {
  connect(opts: ConnectOptions): ReturnType<typeof connectDaemon>; // injectable in tests
  sink: OutputSink; // write() / error() (stdout/stderr abstraction)
  rpcTimeoutMs?: number; // default RPC timeout override
  connectOverrides?: Pick<ConnectOptions, "transport" | "clientId" | "home">; // test hooks
  daemon?: DaemonRuntime; // local daemon control override for tests
  relay?: RelayRuntime; // local relay-server control override for tests
  update?: UpdateRuntime; // self-update control override for tests
  pi?: PiRuntime; // embedded Pi CLI proxy runtime override for tests
  auth?: AuthRuntime; // Pi auth-engine seam (ModelRuntime login/status/logout) override for tests
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
  `relay-control.ts`'s `subprocessRelayStarter`. This does **not** extend to Pi's own auth engine:
  the `auth` group loads `@earendil-works/pi-coding-agent`'s `ModelRuntime` in-process, lazily —
  `auth-runtime.ts` only constructs it inside an `auth login`/`status`/`logout` action, never at
  import or registration time — and writes Pi's own `auth.json` under Pi's own file lock
  (`FileAuthStorageBackend`), the same file the daemon's spawned `pi --mode rpc` processes read.
  `ModelRuntime` is neither "daemon" nor "relay" code, so this doesn't contradict the rule above;
  it's a second, narrower exception worth naming explicitly. Note this is orthogonal to a
  pre-existing, unrelated fact: `daemon-commands.ts` and `pi-commands.ts` already statically import
  `@av-pi-studio/server`, whose module graph transitively pulls in the real
  `@earendil-works/pi-coding-agent` package for **every** CLI invocation, including `--help` —
  confirmed with a real `node:module` `resolve`/`load` hook trace, not just inspection. So the
  module is already loaded before any auth command runs; `auth-runtime.ts`'s own guarantee is
  narrower and independently true regardless: `ModelRuntime.create()` itself (the expensive part —
  auth-store init, model list load, provider rebuild) is never _invoked_ until a real `auth`
  command needs it (confirmed with the same live trace, instrumenting `ModelRuntime.create`
  directly: zero invocations for `--help`/`ls`, exactly one for `auth status`).
- **`extensions list --local` (sprint-057/task-005) is a third, narrower exception, alongside the
  auth engine.** It reads `@av-pi-studio/server`'s pure extension-planning surface in-process —
  `curated-packs.ts`/`sync-planner.ts`/`extensions-state.ts` (re-exported from the package's public
  index, `packages/server/src/extensions/index.ts`) plus `daemon-config.ts`'s `loadConfig` — to run
  the same dry-run planner a connected daemon runs, so `extensions list` works identically with or
  without one. None of these modules start a WS server, bind a port, spawn `pi`, or write daemon
  state; `extensions-commands.ts` never imports `ExtensionsService`/`sync-executor.ts` (the
  orchestration/install-spawning half) or anything under `daemon/`. This is why the rule's
  "never runs daemon/relay code in-process" is about **daemon lifecycle/mutation** code, not every
  line ever exported from `@av-pi-studio/server` — a distinction the auth-engine exception already
  established. `resolvePiAgentDir` (`agent/pi-home.ts`) was extracted out of `provider-registry.ts`
  specifically so this in-process read path never reaches `providers/pi/agent.js` or
  `providers/mock/mock-provider.js` either — see root `AGENTS.md`'s dependency-graph note.
- **Interactive prompt rendering is lazy too.** `auth-interaction.ts` is on `program.ts`'s static
  import path (so it loads on every CLI start), but `@inquirer/prompts` sits behind an
  `await import()` taken only when a prompt is about to render — verified with a `node:module`
  resolve hook against a positive control: zero `@inquirer/*` resolutions for `--help` and for
  `auth login --api-key`, 31 for a direct import. Keep it that way: never hoist it to a static
  import.
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
state machine, output rendering, pairing URL construction, and the `auth` group's
`auth-runtime.test.ts` (path resolution, lazy `ModelRuntime` construction), `auth-interaction.test.ts`
(prompt/notify rendering, select delegation, notify/prompt serialization ordering, abort paths),
and `auth-commands.test.ts` (login/status/logout orchestration against a fake `AuthRuntime`, no
real Pi import, no network — mirrors the `pi-commands.test.ts` pattern). The interactive layer is
tested through the `TerminalIo` seam with fakes, never a real TTY; the actual inquirer rendering
(arrow keys, filtering, masking, QR placement) is verified by driving the built binary in a real
PTY.
