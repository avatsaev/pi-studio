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
| `-H, --host <host>` | Daemon target — `workstation.local:6767`, `ws://…`, or bare `host:port` |
| `--password <password>` | Password for a password-protected daemon |
| `--home <dir>` | Override `$PI_STUDIO_HOME` (used for the client-id store) |
| `--json` | Render command output as JSON instead of a table |

**Connection resolution**: `--host host:port` → `ws://host:port`; `--host ws://…`/`wss://…` is
used as-is; with no `--host`, the CLI targets `ws://127.0.0.1:6767`.

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

### Feature groups

Each of the following maps to the corresponding daemon RPC family:

| Group | Sample commands |
|---|---|
| `terminal` | `create`, `list`, `close` |
| `chat` | `create-room`, `post`, `read`, `wait` |
| `schedule` | `create`, `list`, `delete`, `trigger` |
| `loop` | `create`, `list`, `stop`, `status` |
| `provider` | `list`, `models`, `modes`, `refresh` |
| `worktree` | `create`, `list`, `delete` |
| `project` | `open`, `list` |
| `permit` | `respond` — approve/deny a pending tool-call permission request |

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

The CLI only ever speaks the WebSocket API via `@av-pi-studio/client` — it never imports from
`@av-pi-studio/server` directly. A stable per-machine `clientId` is generated on first use and
stored at `$PI_STUDIO_HOME/client-id`; `clientType` is always `"cli"`.

## Development

```bash
npm run build       # tsc -b (also chmod +x's the published binary)
npm test -- --project packages/cli
```

Tests cover command parsing, provider-spec parsing, stream-event formatting, the daemon-control
state machine, output rendering, and pairing-URL construction — all against an injected
`CliContext` (stub output sink + mock `DaemonRuntime`), never a real spawned daemon.
