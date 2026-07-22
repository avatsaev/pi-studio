# `@av-pi-studio/cli`

`pi-studio` — the terminal client for Pi-Studio. Drives a daemon (local or remote) over its
WebSocket API: run and manage agents, control the local daemon's lifecycle, and drive terminals,
chat rooms, schedules, loops, worktrees, and permissions from the command line.

---

## Install

```bash
npm install -g @av-pi-studio/cli
```

This exposes the `pi-studio` binary on your `PATH`. Without a global install, run it via:

```bash
npx @av-pi-studio/cli [options] [command] [args]
```

## Quick start

```bash
# start a local daemon (if one isn't already running) and print a pairing QR code
pi-studio daemon start

# check daemon health
pi-studio daemon status

# run an agent
pi-studio agent run --provider pi/claude-3-5-sonnet "implement user authentication"

# list agents, attach to stream live output
pi-studio agent ls
pi-studio agent attach <agentId>

# target a remote daemon instead of the local one
pi-studio --host workstation.local:6767 agent ls
```

Run `pi-studio --help` (or `<command> --help`) for the full command tree.

## Global options

| Flag | Description |
|---|---|
| `-H, --host <host>` | Daemon target — bare `host:port`, or a URL with a `ws://`/`wss://` or `http://`/`https://` scheme (e.g. `workstation.local:6767`, `https://box.local:6767`) |
| `--password <password>` | Password for a password-protected daemon |
| `--home <dir>` | Override `$PI_STUDIO_HOME` (used for the client-id store) |
| `--json` | Render command output as JSON instead of a table |
| `-v, --version` | Print the installed CLI version and exit |

**Connection resolution**: `--host host:port` → `ws://host:port`; a `ws://`/`wss://` URL is used
as-is; `http://`/`https://` are accepted for familiarity and mapped to `ws://`/`wss://` (the daemon
is an HTTP server that upgrades to WebSocket on the same port); `wss://`/`https://` imply TLS. With
no `--host`, the CLI targets `ws://127.0.0.1:6767`.

**Default action** (no subcommand):
- `pi-studio <path>` — open that path as a project on the daemon.
- `pi-studio` (bare) — ensure a local daemon is running, then print a pairing QR code.

## Command tree

### `agent`

| Command | Description |
|---|---|
| `agent run --provider pi/<model> "prompt"` | Create an agent and run the first turn |
| `agent ls` | List all agents |
| `agent attach <agentId>` | Stream an agent's live events |
| `agent send <agentId> "prompt"` | Send a follow-up prompt |
| `agent stop <agentId>` | Interrupt the current turn |
| `agent wait <agentId>` | Block until the agent goes idle or closes |
| `agent timeline <agentId>` | Print paged timeline history |
| `agent inspect <agentId>` | Print the full agent record |
| `agent archive <agentId>` | Soft-delete |
| `agent delete <agentId>` | Hard delete |
| `agent update <agentId>` | Update model/mode/features/title/labels |
| `agent resume <agentId>` | Resume a closed session |
| `agent import --provider pi --cwd /path --handle <h>` | Import a provider-native session |

Provider spec parsing (`--provider`): `pi/claude-3-5-sonnet` → provider `pi`, model
`claude-3-5-sonnet`; bare `pi` → provider only; `mock` → the credential-free mock provider.

### `daemon`

| Command | Description |
|---|---|
| `daemon start` | Spawn a local daemon if one isn't already running, then print a pairing QR |
| `daemon stop` | Send SIGTERM to the local daemon |
| `daemon status` | Print health + PID |
| `daemon set-password <pw>` | Bcrypt-hash a password into `$PI_STUDIO_HOME/config.json` |
| `daemon pair` | Print the pairing URL/QR for an already-running daemon |

### `relay`

| Command | Description |
|---|---|
| `relay start [--listen <host:port>]` | Spawn a local relay server (default `0.0.0.0:7000`), wait for health |
| `relay stop` | Send SIGTERM to the local relay |
| `relay status [--listen <host:port>]` | Print up/down for the relay at that address |

A self-hosted, zero-knowledge relay (`@av-pi-studio/relay`) that lets a client reach a daemon
behind a firewall/NAT — the daemon dials out to it; see that package's README for the full
picture. Runs as its own managed process, entirely decoupled from daemon lifecycle: point a
daemon at it via `daemon.relay.endpoint` in `config.json` (`PI_STUDIO_RELAY_ENDPOINT` env), not
through this command.

### `web`

| Command | Description |
|---|---|
| `web [--web-host <host>] [--web-port <port>] [--daemon-host <host>]` | Serve the prebuilt web-client SPA as a static site |

Serves the built `@av-pi-studio/web-client` UI (`dist/web`) via a minimal static file server with
SPA fallback — no vite/dev dependency at runtime, works from any install shape. `--daemon-host`
(falls back to the global `--host`) pre-fills the printed URL's `?host=&connect=1` so the browser
tab auto-connects; the command never itself probes or starts a daemon. Blocks until
`SIGINT`/`SIGTERM`.

### `update`

| Command | Description |
|---|---|
| `update [--check]` | Self-update to the latest `@av-pi-studio/cli` version published on npm |

Shells out to the same `npm install -g @av-pi-studio/cli@<version>` path used to install the CLI
in the first place (see Install above), so it respects your npm config (registry mirrors, auth,
proxies) instead of reimplementing a registry client. `--check` reports whether an update is
available without installing anything.

### Feature groups

`chat`, `terminal`, `loop`, `schedule`, `permit`, `provider`, and `worktree` are sibling top-level
command groups (there is no `feature` wrapper, and no `project` group — opening a project is the
top-level `open <path>` command shown above):

| Group | Commands |
|---|---|
| `chat` | `create <name> [--purpose]`, `ls`, `inspect <roomId>`, `post <roomId> <message> [--from]`, `read <roomId> [-n]`, `wait <roomId>`, `delete <roomId>` |
| `terminal` | `ls`, `create [--workspace] [--cwd]`, `capture <slot>`, `send-keys <slot> <data>`, `kill <slot>` |
| `loop` | `run <prompt> [--max]`, `ls`, `inspect <loopId>`, `logs <loopId>`, `stop <loopId>` |
| `schedule` | `create <cron> <prompt>`, `ls`, `inspect <id>`, `update <id> [--cron] [--prompt]`, `pause <id>`, `resume <id>`, `run-once <id>`, `logs <id>`, `delete <id>` |
| `permit` | `ls`, `allow <permissionRequestId>`, `deny <permissionRequestId>` |
| `provider` | `ls`, `models <providerId>` |
| `worktree` | `create <name> [--workspace]`, `ls`, `archive <name>` |

## Using it as a library

The CLI's building blocks are also exported for programmatic use:

```ts
import { withDaemon } from "@av-pi-studio/cli";

await withDaemon(ctx, opts, async (daemonClient) => {
  // daemonClient is a connected @av-pi-studio/client DaemonClient
});
```

`withDaemon` resolves the target URL from `--host`/defaults, connects, runs your callback, then
disconnects — handling `RpcError`s and connection failures with clean stderr output and non-zero
exit codes along the way.

## How it talks to the daemon

The CLI process never runs daemon/relay code in-process — it only speaks the WebSocket API to
drive an existing daemon. It resolves `@av-pi-studio/server`'s/`@av-pi-studio/relay/server`'s
absolute module URL via `import.meta.resolve` (never `await import()`) purely to bake that URL
into a detached `node -e` subprocess it spawns for `daemon start`/`relay start` — see
`daemon-control.ts`'s `subprocessStarter` and `relay-control.ts`'s `subprocessRelayStarter`. A
stable per-machine `clientId` is generated on first use and stored at
`$PI_STUDIO_HOME/client-id`; `clientType` is always `"cli"`.

## Development

```bash
npx vitest run packages/cli
```

Tests cover command parsing, provider-spec parsing, stream-event formatting, the daemon-control
state machine, output rendering, and pairing-URL construction — all against an injected
`CliContext` (stub output sink + mock `DaemonRuntime`), never a real spawned daemon.
