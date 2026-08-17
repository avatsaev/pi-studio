# CLI — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md),
> [agent-sessions.md](agent-sessions.md), [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md)

## Purpose

`pi-studio` is a Commander.js terminal client that speaks the same WebSocket protocol as the app and can
also start/manage a local daemon. It mirrors most daemon capabilities (agents, chat, terminals,
loops, schedules, permissions, providers, worktrees) with Docker-style ergonomics. Common
agent operations are also exposed at the top level (`pi-studio ls`, `pi-studio run`, etc.).

## Public Contract

### Global options
- `--host <host>` — daemon/host target (default local daemon). Remote: `--host workstation.local:6767`.
- Auth/relay options as applicable (password, relay endpoints).

### Command tree
| Group | Commands |
|-------|----------|
| `agent` (also top-level) | `ls`, `run`, `import`, `attach`, `logs`, `stop`, `delete`, `send`, `inspect`, `wait`, `archive`, `reload`, `update`, `mode` |
| `auth` | `login [provider] [--type api_key\|oauth] [--api-key <key>]`, `status`, `logout <provider>` — CLI-local, daemon-free (see `provider-auth-cli.md`) |
| `daemon` | `start`, `stop`, `restart`, `status`, `pair`, `set-password`, `rotate-key` |
| `chat` | `ls`, `create`, `inspect`, `post`, `read`, `wait`, `delete` |
| `terminal` | `ls`, `create`, `capture`, `send-keys`, `kill` |
| `loop` | `run`, `ls`, `inspect`, `logs`, `stop` |
| `schedule` | `create`, `ls`, `inspect`, `update`, `pause`, `resume`, `run-once`, `logs`, `delete` |
| `permit` | `allow`, `deny`, `ls` |
| `provider` | `ls`, `models` |
| `worktree` | `create`, `ls`, `archive` |
| top-level | `pi-studio <path>` (open), `onboard`, `open`, `update [--check]` (self-update via `npm install -g`, then always also runs `pi update --extensions` to update already-installed pi extensions) |

### Example invocations
```
pi-studio                                  # start/connect; show QR for pairing
pi-studio run --provider pi/<model> "implement user authentication"
pi-studio run --provider pi/<model> --worktree feature-x "implement feature X"
pi-studio ls                               # list running agents
pi-studio attach abc123                    # stream live output
pi-studio send abc123 "also add tests"     # follow-up
pi-studio --host workstation.local:6767 run "run the full test suite"
```

## Behavior & Algorithms

```
function main(argv):
    parse global options (host, auth)
    if no daemon target reachable and command needs one:
        for `pi-studio`/`daemon start`: start a local daemon (managed), print QR pairing
    connect DaemonClient(host) → hello handshake
    dispatch subcommand → corresponding WS RPC(s)
    render output (table/json) to stdout; exit code reflects success/failure
```

- `pi-studio` with no command (or `daemon start`) can start the local daemon and render a **QR code** /
  pairing link so other clients can connect.
- `attach` subscribes to the agent timeline and streams events to the terminal; `logs` fetches
  history.
- `--provider pi/<model>` form combines provider id and model.
- `run --worktree <name>` launches inside a Pi-Studio worktree.
- Remote daemons are reached via `--host` (direct) — the same protocol as the app.

## Data & Persistence
- A client id is persisted locally (e.g. `cli-client-id`) so the CLI presents a stable `clientId` in
  the hello handshake. The daemon owns all real state.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Daemon not running | Start a local daemon (where appropriate) or error with guidance |
| Unknown agent id | Error exit code + message |
| RPC failure | Surface `rpc_error` message; nonzero exit |
| Remote host unreachable | Connection error; nonzero exit |
| Password-protected daemon | Require password option/subprotocol |

## Dependencies
- Internal: `@av-pi-studio/client` (DaemonClient), protocol schemas, local daemon spawner.
- External: Commander.js, terminal QR rendering.

## Acceptance Criteria
- [ ] `pi-studio run --provider <p>/<model> "<prompt>"` creates and runs an agent and prints its id.
- [ ] `pi-studio ls` lists running agents; `-a -g` lists all/global.
- [ ] `pi-studio attach <id>` streams the live timeline.
- [ ] `pi-studio --host <host:port> ...` targets a remote daemon over the same protocol.
- [ ] `pi-studio daemon start` starts a daemon and shows a pairing QR code.
- [ ] Commands map to the same RPCs as app/MCP equivalents.

## TODO(verify)
- [ ] Exact output formats (table vs json) and flags per command.
- [ ] CLI relay/pairing flow specifics (`daemon pair`).
