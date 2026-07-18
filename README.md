# Pi-Studio

Self-hosted, local-first system for running and controlling the **Pi** AI coding agent. A long-lived
**daemon** runs on your machine, manages agent processes, terminals, git worktrees, and projects, and
exposes a WebSocket API. Clients (the CLI today; mobile/web/desktop apps in later sprints) connect to
the daemon to observe and drive agents.

Your code never leaves your machine.

## Requirements

- **Node.js ≥ 20** (developed on Node 24)
- **npm** (workspaces)
- For the real `pi` provider: **pi credentials** only — the `pi` CLI itself is bundled as a dependency
  (`@earendil-works/pi-coding-agent`), so no global install is needed. Set an API key
  (`ANTHROPIC_API_KEY`, etc.) or configure `~/.pi/agent/auth.json`. A built-in `mock` provider works
  with no credentials at all.

## Install & build

```bash
npm install
npm run build          # builds all workspace packages (protocol → … → server → cli)
```

You can also build just the daemon:

```bash
npm run build:server
```

## Start the daemon (server)

The daemon is the server. The simplest way to start it:

```bash
npm start              # builds the server, then starts the daemon in the foreground
```

`npm start` runs `build:server` first and then launches the daemon. If the server is already built,
start it directly without rebuilding:

```bash
npm run start:server   # node packages/server/dist/daemon/main.js
```

By default the daemon:

- listens on **`127.0.0.1:6767`**
- stores all state under **`$PI_STUDIO_HOME`** (default **`~/.pi-studio`**)
- writes rotating NDJSON logs to **`$PI_STUDIO_HOME/logs/`**
- writes a PID lock at **`$PI_STUDIO_HOME/pi-studio.pid`**

It runs in the foreground; press **Ctrl-C** (SIGINT) or send SIGTERM to shut down cleanly (the PID
lock is released and the HTTP/WS servers close).

### Verify it's running

```bash
curl http://127.0.0.1:6767/api/health
# → {"status":"ok"}
```

### Configuration (environment variables)

All are optional; the daemon also reads `$PI_STUDIO_HOME/config.json`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_STUDIO_HOME` | `~/.pi-studio` | State + config + logs directory |
| `PI_STUDIO_LISTEN` | `127.0.0.1:6767` | Daemon listen address (`host:port`) |
| `PI_STUDIO_PASSWORD` | _(unset)_ | Require this password for connections (bcrypt-checked) |
| `PI_STUDIO_HOSTNAMES` | `localhost,*.localhost` | Allowed `Host` header values |
| `PI_STUDIO_SERVER_ID` | _(generated)_ | Stable server identity |

Example — run on a different port with a password and an isolated home:

```bash
PI_STUDIO_HOME=/tmp/pi-studio-dev \
PI_STUDIO_LISTEN=127.0.0.1:6790 \
PI_STUDIO_PASSWORD=hunter2 \
npm run start:server
```

## Start it via the CLI (alternative)

The `@av-pi-studio/cli` package provides a `pi-studio` command. After `npm run build`, you can run it
through the workspace bin:

```bash
# start a local daemon (if one isn't already running) and print a pairing QR code
node packages/cli/dist/cli.js daemon start

# report daemon health
node packages/cli/dist/cli.js daemon status

# set a daemon password (bcrypt-hashed into config.json; enforced on next start)
node packages/cli/dist/cli.js daemon set-password hunter2

# stop the local daemon
node packages/cli/dist/cli.js daemon stop
```

> Tip: `npm link` inside `packages/cli` (or installing the package) exposes the `pi-studio` binary on
> your `PATH` so you can run `pi-studio daemon start` directly.

Once a daemon is running, drive agents with the CLI:

```bash
node packages/cli/dist/cli.js run --provider pi/<model> "implement user authentication"
node packages/cli/dist/cli.js ls                 # list agents
node packages/cli/dist/cli.js attach <agentId>   # stream the live timeline
node packages/cli/dist/cli.js --host workstation.local:6767 ls   # target a remote daemon
```

Run `node packages/cli/dist/cli.js --help` for the full command tree (`agent`, `daemon`, `chat`,
`terminal`, `loop`, `schedule`, `permit`, `provider`, `worktree`).

## Temporary UI POC (visual feature testing)

A throwaway browser UI under [`poc/`](poc/) lets you exercise every feature visually. It talks the
daemon WebSocket protocol directly (no build step, vanilla JS).

> **Note:** the production daemon (`npm start`) ships an *empty* handler registry — feature wiring is
> a later sprint. The POC therefore runs a **dev daemon** (`dev-bootstrap.ts`) that wires **all**
> feature services (agents, terminals, chat, schedules, loops, projects/git/worktrees, files,
> providers) onto the live registry. It's for local testing only; `bootstrap.ts` stays untouched.

Two terminals:

```bash
# 1) build + start the dev daemon (all features wired). Binds 0.0.0.0:6767 by default so it's
#    reachable over the LAN; prints ready-to-use connect URLs on startup.
npm run dev:daemon

# 2) serve the UI (binds 0.0.0.0:7070 by default)
npm run poc
```

The dev daemon prints connect URLs on startup, e.g.:

```
Pi-Studio DEV daemon listening on 0.0.0.0:6767 (all features wired, bundled pi)
  connect: ws://192.168.1.20:6767   POC: http://192.168.1.20:7070/?host=ws://192.168.1.20:6767&connect=1
```

Open the printed POC URL from any device on the network and it auto-connects. (Locally, just open
<http://127.0.0.1:7070> and click **Connect**.) The default agent provider is **pi**; switch the
provider dropdown to **mock** for a dependency-free smoke test.

### Running on a network

The daemon is a WebSocket server, and the POC is a plain web page that connects to it by URL — so you
can run the daemon on one machine and connect from another (laptop, phone) over the LAN:

- The daemon binds `0.0.0.0:6767` by default (override with `PI_STUDIO_LISTEN=host:port`). Connect via
  the server's IP: `?host=ws://SERVER_IP:6767`. Literal IP addresses are always accepted by the
  Host-header allowlist, so no extra config is needed.
- To reach the server by **hostname** instead of IP, add it to the allowlist:
  `PI_STUDIO_HOSTNAMES=my-box.local` (localhost/`*.localhost` are always allowed).
- Set a password with `PI_STUDIO_PASSWORD=…` and pass it in the POC's **password** field (or
  `&password=…`) before exposing the daemon beyond a trusted network.

The UI has panels for providers, agents (create/run/list/inspect/send/stop/wait/timeline + a live
event stream), terminals, chat rooms, schedules, loops, projects/git/worktrees, files, and a raw-RPC
console. The right-hand **event log** shows every request, response, `rpc_error`, and broadcast
(`agent_stream`, `agent_update`, …).

The top **Chat (streaming)** panel is a simple conversational view: pick a provider, type a message,
and the assistant's reply streams into a growing bubble (with tool-call / reasoning lines). The first
message creates an agent; subsequent messages continue it. "new conversation" starts a fresh agent.

Handy URL params for auto-connecting: `?host=ws://127.0.0.1:6767&connect=1` (and `&password=…`).
You can also auto-send a first chat message for testing: `&provider=mock&say=hello`.
The POC server honours `POC_PORT` and `POC_BIND` env vars.

### Troubleshooting: pi provider unavailable

The `pi` CLI is **bundled** inside the `@earendil-works/pi-coding-agent` dependency — the daemon
launches `node <pkg>/dist/cli.js --mode rpc`, so **no global `pi` install is required**. You only need
pi *authenticated* (an API key or stored credentials): either set `ANTHROPIC_API_KEY` (etc.) in the
daemon's environment, or have `~/.pi/agent/auth.json` configured.

If you want to use a *different* pi than the bundled one, point the daemon at an absolute path in
`$PI_STUDIO_HOME/config.json`:

```json
{ "agents": { "providers": { "pi": { "command": ["/abs/path/to/pi", "--mode", "rpc"] } } } }
```

Or just switch the POC's **provider** dropdown to **mock** for a dependency-free test.

A missing/unresolvable pi surfaces as a clean `rpc_error` in the event log ("Pi provider
unavailable…") instead of crashing the daemon.

The daemon speaks the real Pi RPC protocol (`pi --mode rpc`, strict JSONL): a `create_agent` with the
`pi` provider runs an actual model turn and streams `assistant_message` deltas, tool calls, and
`turn_completed` into the event log. A literal `~` in the `cwd` field is expanded to your home
directory.

## Development

```bash
npm test            # run the full test suite (Vitest)
npm run typecheck   # tsc -b across all packages
npm run lint        # oxlint
npm run fmt:check   # oxfmt --check
```

## Project layout

```
packages/
  protocol/   wire schemas + shared protocol types
  client/     low-level daemon WS driver + PiStudioClient SDK facade
  server/     the daemon (agents, terminals, git, projects, orchestration)
  cli/        pi-studio terminal client + local daemon/relay control
  highlight/  syntax-highlight helper
  relay/      E2EE relay (channels, self-hosted server, Cloudflare Workers adapter)
  web-client/ production React/Vite browser UI
  desktop/    Electron wrapper (later sprint)
poc/                temporary browser UI for visual feature testing
clean-room-scope/   specifications + the sprint implementation plan
```

The detailed specifications live under [`clean-room-scope/`](clean-room-scope/) —
[`MAIN-SCOPE.md`](clean-room-scope/MAIN-SCOPE.md) is the entry point.
