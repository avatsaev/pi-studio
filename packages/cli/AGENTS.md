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

### The compiled single binary

`npm run build:binary -- --target <linux-x64|linux-arm64|darwin-arm64|darwin-x64>`
(`scripts/build-binary.mjs`, after `npm run build`) compiles `dist/binary-main.js` with the root's
pinned Bun into `dist-binary/pi-studio-<version>-<target>/` and a `.tar.gz`: `pi-studio` (the whole
CLI plus daemon, relay, Pi and `skills`), the `bun` script, Pi's runtime assets and `web/`.
`binary-main.ts` dispatches on the first argument (`binary-dispatch.ts` decides): `__daemon <json>`,
`__relay <json>`, `__pi …`, `__skills …`, `__update-helper <json>` (the server's `runBinaryHelperMain`,
then `process.exit`), else the normal CLI (`run`). The sub-command names and JSON are the server's runtime
seam (`SUBCOMMAND`, `DaemonOpts`, `RelayOpts`). `node-pty` is `--external` (never loaded under Bun).
`--version <x.y.z>` (the executable reports that version: the build rewrites the three packages'
compiled `dist/version.generated.js` for the compile and puts them back) and `--out-dir <dir>` exist
for `scripts/binary-update-check/`, never for a release. Darwin builds are ad-hoc signed with
`codesign --force -s -` on a macOS host (Bun's compile already signs some darwin builds).
`scripts/binary-container-check.sh` runs the acceptance commands in a Node-less container.

## Source layout

```
src/
  cli.ts                 Entrypoint — parse argv, call run(), exit with code.
  binary-main.ts         Entry of the compiled binary (not part of the npm `bin`): runs what `binary-dispatch.ts` picks.
  binary-dispatch.ts     parseBinaryCommand(args) → daemon|relay|pi|skills|update-helper|cli; parseDaemonOpts/parseRelayOpts validate the JSON arguments.
  binary-dispatch.test.ts
  program.ts             buildProgram() — root Commander program, global options, default action.
  version.generated.ts   PACKAGE_VERSION — generated from package.json by `scripts/gen-version.mjs`
                         (committed, rewritten by every build; `version.generated.test.ts` guards drift).
  cli-core.ts            CliContext, GlobalOptions, withDaemon() helper, exit codes.
  connection.ts          parseHost() — parse "host:port" or bare host strings.
  client-id.ts           Stable per-machine client-id storage + resolveHome().
  output.ts              renderTable(), renderObject(), renderJson() — table/JSON output helpers.
  pairing.ts             buildPairingUrl() + readDaemonPublicKey() — relay pairing URL construction.
  qr.ts                  renderQrToTerminal() — QR code string via the `qrcode` library.

  auth-runtime.ts        AuthRuntime seam — resolvePiAuthPaths() (daemon-parity `<piHome>/agent/auth.json`),
                          lazy `ModelRuntime` construction (`defaultAuthRuntime(paths, prepare?)`: `prepare`,
                          `CliContext.prepareAuth`, runs once before Pi first loads; the binary sets Pi's Bun
                          runtime setup so an OAuth login finds its flows), provider listing/checkAuth/login/logout.
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
  update-commands.ts     Top-level `update` command — self-update the globally installed CLI.
  update-commands.test.ts
  update-control.ts      UpdateRuntime — getLatestVersion/installGlobal seam (+ `binary?: BinaryUpdateRuntime`,
                          set only in the compiled binary: blocker/lookup/install/switchCurrent/prune/
                          startDaemon); defaultUpdateRuntime() wires `npmLatestVersion`/`npmGlobalInstall`
                          from `@av-pi-studio/server` (`update/npm.ts`, where the ENOTEMPTY self-heal and
                          compareVersions live) and the binary's `update/binary-*` modules;
                          currentBinaryDaemonStarter; re-exports PACKAGE_NAME/RELEASES_PAGE/compareVersions;
                          CURRENT_VERSION.
  update-control.test.ts

  promise-with-resolvers.d.ts   Promise.withResolvers() ambient decl (lib predates ES2024;
                                 mirrors workbench/src/lib/promise-with-resolvers.d.ts).

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
| `-v, --version`         | Print the CLI's version (`@av-pi-studio/cli`'s own `package.json` version, via the generated `version.generated.ts` — not hardcoded) and exit 0 |

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

**Partial tool output is suppressed (sprint-058).** The daemon streams ephemeral `tool_call` events
with `partial: true` (live tool output snapshots, up to ~5/s per call). `agent attach` (and its
top-level `attach` alias) skip them at the subscription site in `agent-commands.ts` — before the
`--json` branch, so **both** plain and `--json` modes print nothing for a partial and no duplicate
`[tool running]` lines appear. `agent logs`/`log` are fetch-based and never see partials (they are
never persisted). Rendering streamed tool output in the CLI is not implemented; the live tail is a
web-client affordance.

`session` through `last-message` (sprint-037) are CLI equivalents of Pi built-in slash commands
that have a real Pi RPC equivalent (`/session`, `/compact`, `/new`, `/resume`, `/fork`, `/clone`,
`/name`, `/export`, `/model`, `/copy`). Built-ins with no RPC equivalent (`/settings`, `/hotkeys`,
`/changelog`, `/login`, `/logout`, `/reload`, `/scoped-models`, `/trust`, `/share`, `/quit`) are
TUI-only per Pi's own RPC docs and have no CLI command here — see `packages/server/AGENTS.md`'s
Agent subsystem section for the full rationale. (Naming note: Pi's own TUI-only `/reload` in that
excluded list is unrelated to this CLI's `reload <agentId>` command above — the latter is a
`resume_agent` RPC call, named for reloading a closed _daemon_ session, not Pi's
extensions/skills/keybindings reload.)

`compact` waits up to the SDK's `COMPACT_TIMEOUT_MS` (10 min, imported from
`@av-pi-studio/client`) rather than the CLI's default RPC timeout. Since sprint-074 the daemon
rejects `agent_compact_request` with `busy: …` while the agent is running or already compacting —
`pi-studio agent compact` on a running agent therefore errors instead of aborting the turn (Pi's
`compact()` begins with `abort()`).

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
| `daemon stop`                             | Send SIGTERM to the local daemon, then wait up to 10 s for the process to exit                                              |
| `daemon restart`                          | Stop (waiting for the old process to exit), then start the local daemon                                                      |
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

**`--json` (`start`, `restart`, `pair`, `stop` only).** The global `--json` flag makes each write
exactly one JSON line to stdout (no QR, no prose; errors are JSON on stdout, not stderr). `start`
and `restart` pass `{ json: true }` to `ensureLocalDaemonAndPair` (an explicit parameter — the
function never reads the global flag, so `rotate-key`, `onboard` and the default action stay
byte-for-byte unchanged under `--json`); `restart` prints only the start result. `pair` passes it to
`printPairing(ctx, home, host, json)`. `relay` is the relay endpoint string the link routes through
(`resolvePairingRelayInfo(...).endpoint`) or `null`; `pairingUrl` is a credential on relay links.

| Command | Success (exit 0) | Failure (exit 1) |
| --- | --- | --- |
| `start`, `restart` | `{"up":true,"started":<bool>,"host","port","pairingUrl","relay"}` (`started:false` when already running) | `{"up":false,"host","port","error":"not_healthy"}`; healthy but no key file: `{"up":true,"started":<bool>,"host","port","error":"no_keypair"}` |
| `pair` | `{"pairingUrl","relay"}` | `{"error":"no_keypair"}` |
| `stop` | `{"stopped":true}` | `{"stopped":false}` (no daemon); `{"stopped":false,"error":"still_running"}` (it did not exit in 10 s) |
| `restart` when the old daemon did not exit | — | `{"up":false,"host","port","error":"still_running"}` |

`DaemonRuntime` (`daemon-control.ts`; every member injectable, tests pass fakes):

- `probe(host, port)` — HTTP GET `/api/health`, returns true if 200.
- `hash(plaintext)` — bcrypt.
- `kill(pid, signal?)` — `process.kill`; false on any failure.
- `start(opts)` — spawn the daemon (`subprocessStarter`, argv from `daemonCommand`) as a detached child.
- `waitForExit(pid, timeoutMs)` — `waitForProcessExit` from `@av-pi-studio/server` (100 ms poll,
  signal 0); `timeoutMs: 0` is one liveness check.
- `readVersion(host, port)` — `version` from the `/api/health` body (`httpHealthVersionReader`);
  `null` when unreadable. Used by `update` to report the version answering after a restart.

Free functions: `waitForDaemon(runtime, host, port, opts)` polls health until up or timeout;
`stopDaemon(home, runtime)` (async) → `StopResult { stopped, error?: "still_running" }`: no pid file
→ `{stopped:false}`; SIGTERM, then `waitForExit(pid, STOP_TIMEOUT_MS = 10 000)`; a pid file whose
process is gone (the signal failed and one liveness check says gone) is removed and reported as not
running; a process that survives the wait, or cannot be signalled but exists, is
`{stopped:false, error:"still_running"}`; after a confirmed exit the pid file is removed when it
still names that pid. `daemon restart` and `daemon rotate-key` stop first and, on `still_running`,
start nothing (a start would find the old daemon still answering and call it running).

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

`registerFeatureCommands` registers `chat`, `terminal`, `loop`, `schedule`, `provider`, and
`worktree` as sibling top-level command groups (no `feature` wrapper), plus a top-level
`open <path>` command. Each subcommand maps to a canonical RPC name in `FEATURE_RPC`; several are
flagged `TODO(verify)` in source for wire names not yet confirmed against the real daemon.

| Group         | Commands                                                                                                                                                    | RPC                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`        | `create <name> [--purpose]`, `ls`, `inspect <roomId>`, `post <roomId> <message> [--from]`, `read <roomId> [-n]`, `wait <roomId>`, `delete <roomId>`         | `chat_create_request`, `chat_list_request`, `chat_inspect_request`, `chat_post_request`, `chat_read_request`, `chat_wait_request`, `chat_delete_request`                                                                                        |
| `terminal`    | `ls`, `create [--workspace] [--cwd]`, `capture <slot>`, `send-keys <slot> <data>`, `kill <slot>`                                                            | `list_terminals_request`, `create_terminal_request`, `capture_terminal_request`, `terminal_input`, `kill_terminal_request`                                                                                                                      |
| `loop`        | `run <prompt> [--max]`, `ls`, `inspect <loopId>`, `logs <loopId>`, `stop <loopId>`                                                                          | `loop_run_request`, `loop_list_request`, `loop_inspect_request`, `loop_logs_request`, `loop_stop_request`                                                                                                                                       |
| `schedule`    | `create <cron> <prompt>`, `ls`, `inspect <id>`, `update <id> [--cron] [--prompt]`, `pause <id>`, `resume <id>`, `run-once <id>`, `logs <id>`, `delete <id>` | `schedule_create_request`, `schedule_list_request`, `schedule_inspect_request`, `schedule_update_request`, `schedule_pause_request`, `schedule_resume_request`, `schedule_run_once_request`, `schedule_logs_request`, `schedule_delete_request` |
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
(`packages/relay/src/relay-server.ts` — a `ws` `WebSocketServer` that routes control, data and client
sockets by their first JSON frame (`control.ts`), pipes each client socket to one daemon data socket,
plus a bare `GET /health`). Runs as its OWN managed process, entirely separate from the daemon's
lifecycle — the relay has no identity keypair, no `$PI_STUDIO_HOME` state beyond its own PID file
(`pi-studio-relay.pid`), and no per-project data; it only pairs a client's connection with a data
socket the daemon opened outbound, keyed by session id (architecture/relay-protocol.md). Typically run on a
separate publicly-reachable host from the daemon it relays for.

`RelayRuntime` (`relay-control.ts`, mirrors `DaemonRuntime` exactly):

- `probe(host, port)` — HTTP GET `/health`, returns true if 200.
- `start(opts)` — `relayCommand` (runtime seam; on Node it resolves `@av-pi-studio/relay/server` via
  `import.meta.resolve`, the same pattern `subprocessStarter` uses for `@av-pi-studio/server`) and
  spawn it detached — a `node -e` script calling
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
  spinners, and prompts to behave exactly as native `pi`. Since Pi 1.0.0 that TUI runs
  **fullscreen** (alternate screen) by default; it is Pi's own setting, so restoring normal
  scrollback is Pi's `tuiMode: "regular"` in its `settings.json` or `pi-studio pi --tui-mode
  regular` — never a pi-studio flag.
- The child's exit code is forwarded unchanged as the CLI's own exit code.

`PiRuntime` (`pi-commands.ts`, injectable via `CliContext.pi` for tests):

- `piCommand(args)` — the runtime seam's `piCommand` from `@av-pi-studio/server`
  (`runtime/self.ts`): on Node `[process.execPath, <Pi's declared bin.pi>, …args]`, the entrypoint
  `@earendil-works/pi-coding-agent` itself declares — read from the dependency's own
  `package.json`, not hardcoded, by `resolveBundledPiCli()` — via `import.meta.resolve`, falling
  back to a `node_modules` walk-up and then to the two known entrypoints (`dist/bundle/cli.js`,
  Pi's declared `bin` since 0.84.4; `dist/cli.js`, its declared `bin` through 0.84.3 and still
  shipped); `[execPath, "__pi", …args]` in the binary. Returns `null` on Node if the dependency
  isn't installed. Reading the declared `bin` is deliberate: Pi relocated it in 0.84.4, and the
  dependency range accepts future minors, so a hardcoded path would silently regress to a global
  `pi` on the next relocation.
- `onPath(bin)` — `resolveBinaryOnPath()` (same package): probes a bare binary on `$PATH`.
- `piProxyCommand(runtime, args)` — prefers `runtime.piCommand(args)`; falls back to a global `pi`
  on `$PATH` when the dependency is absent (mirrors the Pi provider's own fallback); returns
  `null` when neither is found (reported as `EXIT_ERROR`).
- `piProxyEnv(opts, env)` — derives `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR` from
  `--pi-home`/`PI_STUDIO_PI_HOME` (same derivation as the server's `agent/pi-home.ts`
  `piHomeEnv()`, kept as a separate implementation here since the CLI has no daemon config context
  when run standalone), so `pi-studio pi` talks to the same Pi config tree the daemon's agents use.
- `spawn({ command, env })` — default implementation forwards signals via shared process-group
  membership and maps a signal-killed child's exit to the conventional `128 + signal` status.

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

`UpdateRuntime` (`update-control.ts`; the engine itself lives in `@av-pi-studio/server`'s
`src/update/npm.ts` — see the `update` exception in the import-rule bullets below):

- `getLatestVersion(pkg)` — server's `npmLatestVersion`: `npm view <pkg> version`; returns `null` on
  any failure rather than throwing, so `runUpdate` can render one clean error line.
- `installGlobal(pkg, version)` — server's `npmGlobalInstall`: `npm install -g <pkg>@<version>`;
  throws on failure. Self-heals npm's own `ENOTEMPTY` rename-collision bug (stale arborist staging
  directory): `installWithStaleStagingRetry` removes the directory npm reported and retries
  (bounded, default 3). Tests: `packages/server/src/update/npm.test.ts`.
- `compareVersions(a, b)` — server's plain numeric `x.y.z` compare, re-exported by
  `update-control.ts`; not a full semver comparator (this monorepo publishes bare releases only).
- `PACKAGE_NAME` — `@av-pi-studio/cli`, re-exported from the server's `version.ts`.
- `CURRENT_VERSION` — this package's own `package.json` version, taken from the generated
  `version.generated.ts` (static import — no `createRequire`; same source as `program.ts`'s
  `-v/--version`) — never hardcoded.

`runUpdate`'s exit code: the CLI self-update step's outcome wins over the extensions step's when
both are attempted (a failed npm install is reported even if `pi update --extensions` happened to
succeed afterward); when the CLI step succeeds or is a no-op ("already up to date"), the
extensions step's exit code (e.g. `EXIT_ERROR` if no embedded/global Pi CLI is resolvable, or Pi's
own `update --extensions` exits nonzero) is surfaced instead.

**Daemon restart.** After a successful install in this run (not when already up to date, not when
the install failed), `restartLocalDaemon` probes `--host` (default 127.0.0.1:6767). A daemon
answering → `stopDaemon` (waits for the exit), `start` on the same `host:port`, `waitForDaemon`,
then prints `daemon restarted: <version>` from `readVersion`. No daemon → nothing happens. A failed
restart prints the reason and exits `EXIT_ERROR` (the install is not undone); the exit order is
install error, then extensions error, then restart error. Tests inject `ctx.daemon`.

**On the compiled binary (sprint-142/task-004).** `defaultUpdateRuntime()` carries `binary:
BinaryUpdateRuntime` only when `isBinary` (Node and every npm test see none, so the npm path above is
unchanged). `runUpdate` then runs `runBinaryUpdate`: `lookup()` reads `daemon-updates/latest.json`
(`PI_STUDIO_DAEMON_UPDATE_URL` overrides the address, for tests and self-hosting; offline /
not-a-manifest → `EXIT_ERROR`); `--check` prints the same two lines as the npm path from the manifest's
version and probes nothing else; an update first asks `blocker(home)` (`binaryBlocker`: the executable
must be `$PI_STUDIO_HOME/bin/versions/<v>/pi-studio` with `bin` writable, else the error names the
releases page) and needs an archive for this system, then `install(home, version)` into
`bin/versions/<version>` and `switchCurrent`; `pi update --extensions` and the restart follow as above,
except the new daemon is started by `binary.startDaemon` (`currentBinaryDaemonStarter`:
`<home>/bin/current/pi-studio __daemon <json>`, i.e. the version just switched to, not the running
process); once a restarted daemon answers, `prune(home, [new, CURRENT_VERSION])` removes the other
version folders (nothing is removed when no daemon was restarted). Tests inject `ctx.update.binary`
(`update-commands.test.ts`); `update-control.test.ts` runs the starter against a stub executable.

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
browser/mobile client can scan/paste it to connect directly (`workbench`'s
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
- **`subprocessStarter`'s spawned `-e` script must call `runDaemon`, never `startDaemon`.**
  `daemonStartScript(serverUrl, {host, port, home})` (`runtime/self.ts` of the server; `daemonCommand`
  wraps it) builds it. `startDaemon` deliberately never
  calls `process.exit()` and installs no signal handlers (it is also embedded in-process by
  `packages/desktop` and the server's own integration tests — see `packages/server/AGENTS.md`'s
  invariant), so the process-level decision belongs to whoever owns the process. Here that is the
  detached child, and `runDaemon` (`daemon/run.ts`) supplies it: exit on a bind failure
  (`EADDRINUSE` would otherwise leave the child alive with a dead HTTP server and `waitForDaemon`
  timing out), SIGINT/SIGTERM → clean close (so `daemon stop` removes `pi-studio.pid`), and the exit
  after a self-update's shutdown (without it the daemon cannot update itself). Test:
  `packages/server/src/runtime/self.test.ts`.
- **The runtime seam (sprint-139/task-002) is a further narrow exception.** `daemon-control.ts`,
  `relay-control.ts` and `pi-commands.ts` import `daemonCommand`, `relayCommand`,
  `piCommand` and `webDist` from `@av-pi-studio/server`'s `runtime/self.ts`: pure argv/path builders
  that spawn and bind nothing. The CLI passes the Node-only module resolvers
  (`import.meta.resolve("@av-pi-studio/server")`, `…/relay/server`, `…/web-client/package.json`) in as
  functions, so they run in its own module graph and are never called by the compiled binary, whose
  commands are `<binary> __daemon|__relay <json>`, `<binary> __pi|__skills <args>` and
  `<binary> __update-helper <json>` (`binary-main.ts`).
- **`binary-main.ts` is the one place the CLI package runs daemon/relay code in-process**, and only
  as the detached child the starters spawn (`<binary> __daemon|__relay …`): it imports `runDaemon`
  and `startRelayServer` statically. The CLI program itself (`cli` kind) still only drives daemons
  over the WebSocket API. Pi's and `skills`' entries are imported dynamically (they run on import),
  from the server's `daemon/binary-runtime.ts`. The `cli` kind passes `prepareAuth: preparePiRuntime`
  (`CliContext`), so `auth login` runs an OAuth flow in the binary; without it the login failed with
  `Cannot find module './anthropic.js'`. It runs on first use of the auth engine, not for every command
  (it renames the process to `pi` and silences warnings; measured cost about 8 ms on `auth status`).
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
- **`update` (sprint-135/task-003) is a further narrow exception.** `update-control.ts` imports the
  server's `update/` surface (`npm.ts`, `install-kind.ts`, `PACKAGE_NAME`, and since sprint-142 the
  binary's `binary-update.ts`/`binary-layout.ts`/`binary-helper.ts`): pure functions, `npm` child
  processes, the manifest download and the link switch, never the daemon's lifecycle, a WS server, or
  daemon state.
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

## Desktop app contract

The desktop app runs `pi-studio` and reads its output. Pinned by `describe("desktop app contract …")` in `src/daemon-commands.test.ts`:

- `--json daemon status`: one line `{ up: boolean, host: string, port: number }`; exit 0 when up, 1 when down.
- `--json daemon start|restart`: one line with `up` (boolean), `host` (string), `port` (number); success adds `started`, `pairingUrl`, `relay`; the failure shapes (`not_healthy`, `no_keypair`, `unprotected_bind` — a non-loopback `-H` host with no `PI_STUDIO_PASSWORD`/`daemon.auth.password`, checked before spawning so the same reason is printed in text mode — and for `restart` only `still_running`: `up:false`, the old daemon did not exit) add `error` (string) and exit 1.
- `--json daemon stop`: `{ stopped: boolean }`, plus `error: "still_running"` (string) when the process did not exit in 10 s (exit 1). The app reads `stopped` only and ignores the rest.
- `--version`: one line, a semantic version, nothing else.

The app reads the last non-empty line of standard output as JSON **whatever the exit code** (a down daemon or a failed start exits 1 and the line still says why), within a limit per command (`--version` and `status` 5 s, `start` and `restart` 90 s, `stop` 15 s). It discards `pairingUrl`. `daemon start` always listens on 6767 (`PI_STUDIO_LISTEN` does not apply). Fields may be added. The listed ones must not be removed, renamed or retyped without changing the desktop app too (`desktop/docs/architecture.md` § The registry and the local daemon).

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
