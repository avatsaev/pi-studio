# Contributing to Pi-Studio

Developer setup, running the daemon and web UI from a checkout, tests, and the monorepo
layout. For using Pi-Studio as an end user, see [`README.md`](README.md) and
[`packages/cli/README.md`](packages/cli/README.md).

## Running from source

Everything above uses the published npm package. To hack on Pi-Studio itself, work from a checkout:

### Requirements

- **Node.js ≥ 20** (developed on Node 24)
- **npm** (workspaces)
- For the real `pi` provider: **pi credentials** only — the `pi` CLI itself is bundled as a dependency
  (`@earendil-works/pi-coding-agent`), so no global install is needed. Set an API key
  (`ANTHROPIC_API_KEY`, etc.) or configure `~/.pi/agent/auth.json`. A built-in `mock` provider works
  with no credentials at all.

### Install & build

```bash
npm install
npm run build          # builds all workspace packages in dependency order (protocol → … → cli)
```

You can also build just the daemon:

```bash
npm run build:server
```

### Start the daemon (server)

The daemon is the server. The simplest way to start it:

```bash
npm start              # builds the server, then starts the daemon in the foreground
```

`npm start` runs `build:server` first and then launches the daemon. If the server is already built,
start it directly without rebuilding:

```bash
npm run start:server   # node packages/server/dist/daemon/main.js
```

By default the production daemon:

- listens on **`0.0.0.0:6767`** (reachable over the LAN; override with `PI_STUDIO_LISTEN`)
- stores all state under **`$PI_STUDIO_HOME`** (default **`~/.pi-studio`**)
- writes rotating NDJSON logs to **`$PI_STUDIO_HOME/logs/`**
- writes a PID lock at **`$PI_STUDIO_HOME/pi-studio.pid`**
- generates a persistent Curve25519 keypair at **`$PI_STUDIO_HOME/daemon-keypair.json`** (used for
  relay pairing; see [Relay](README.md#optional-e2ee-relay-reaching-a-daemon-behind-natfirewall))
- registers the **full** RPC surface (agents, terminals, git/worktrees, projects, chat, loops,
  schedules, files, providers) — this is the real daemon (`bootstrap.ts`), not a stub

It runs in the foreground; press **Ctrl-C** (SIGINT) or send SIGTERM to shut down cleanly (the PID
lock is released and the HTTP/WS servers close).

### Verify it's running

```bash
curl http://127.0.0.1:6767/api/health
# → {"status":"ok"}
```

`GET /api/health` is exempt from the Host-header allowlist and password auth.

### Configuration (environment variables)

All are optional; the daemon also reads `$PI_STUDIO_HOME/config.json`.

| Variable                   | Default                 | Purpose                                                   |
| -------------------------- | ----------------------- | --------------------------------------------------------- |
| `PI_STUDIO_HOME`           | `~/.pi-studio`          | State + config + logs directory                           |
| `PI_STUDIO_LISTEN`         | `0.0.0.0:6767`          | Daemon listen address (`host:port`)                       |
| `PI_STUDIO_PASSWORD`       | _(unset)_               | Require this password for connections (bcrypt-checked)    |
| `PI_STUDIO_HOSTNAMES`      | `localhost,*.localhost` | Allowed `Host` header values (literal IPs always allowed) |
| `PI_STUDIO_SERVER_ID`      | _(generated UUID)_      | Stable server identity                                    |
| `PI_STUDIO_LOG_LEVEL`      | `info`                  | pino log level                                            |
| `PI_STUDIO_RELAY_ENABLED`  | `false`                 | Opt in to dialing out to a relay (see [Optional: E2EE relay](README.md#optional-e2ee-relay-reaching-a-daemon-behind-natfirewall) in the README) |
| `PI_STUDIO_RELAY_ENDPOINT` | _(unset)_               | Relay `host:port` to dial                                 |
| `PI_STUDIO_RELAY_USE_TLS`  | `false`                 | Use `wss://` to reach the relay                           |

Example — run on a different port with a password and an isolated home:

```bash
PI_STUDIO_HOME=/tmp/pi-studio-dev \
PI_STUDIO_LISTEN=127.0.0.1:6790 \
PI_STUDIO_PASSWORD=hunter2 \
npm run start:server
```

### Drive it from the CLI (without installing it)

From a checkout you can run the CLI through the workspace bin instead of a global install — this is
what the CLI README's `pi-studio` commands map to:

```bash
# log in to a model provider (the `pi` provider needs one — see [The `pi` provider](README.md#the-pi-provider) in the README)
node packages/cli/dist/cli.js auth login

# start a local daemon (if one isn't already running) and print a pairing QR code
node packages/cli/dist/cli.js daemon start

# report daemon health / stop it
node packages/cli/dist/cli.js daemon status
node packages/cli/dist/cli.js daemon stop

# set a daemon password (bcrypt-hashed into config.json; enforced on next start)
node packages/cli/dist/cli.js daemon set-password hunter2

# revoke every pairing link/QR ever issued (e.g. one leaked) — mints a fresh keypair and restarts
node packages/cli/dist/cli.js daemon rotate-key
```

> Tip: `npm link` inside `packages/cli` (or installing the package) exposes the `pi-studio` binary on
> your `PATH` so you can run `pi-studio daemon start` directly.

Once a daemon is running, drive agents:

```bash
node packages/cli/dist/cli.js run --provider pi/<model> "implement user authentication"
node packages/cli/dist/cli.js ls                 # list agents
node packages/cli/dist/cli.js attach <agentId>   # stream the live timeline
node packages/cli/dist/cli.js --host workstation.local:6767 ls   # target a remote daemon
```

Run `node packages/cli/dist/cli.js --help` for the full command tree (`agent`/`run`/`ls`/`attach`,
`auth`, `daemon`, `relay`, `chat`, `terminal`, `loop`, `schedule`, `permit`, `provider`,
`worktree`).

### Web UI dev server

`@av-pi-studio/web-client` is the production React 19 + Vite 6 browser UI shown in the README's
screenshots. It talks to the daemon only through the `@av-pi-studio/client` SDK (never a raw
WebSocket).
For UI work, run it under Vite with hot reload instead of through `pi-studio ui`:

```bash
# run the dev daemon (all features + mock provider available) in one terminal
npm run dev:daemon

# run the Vite dev server in another
npm run dev -w packages/web-client        # http://localhost:5173
```

Enter the daemon URL and optional password in the toolbar and click **Connect**. The URL accepts a
bare `host:port`, a `ws://`/`wss://` URL, or `http://`/`https://` (mapped to `ws`/`wss` — the daemon
upgrades HTTP to WebSocket on the same port), e.g. `127.0.0.1:6767` or `https://box.local:6767`. The
password is sent as a `pi-studio.bearer.<pw>` WebSocket subprotocol. To build a
static bundle: `npm run build:web-client` (or `build:electron -w packages/web-client` for the
future Electron shell in `packages/desktop`).

> `npm run dev:daemon` runs `dev-main.js` → `dev-bootstrap.ts`, a **minimal** dev daemon (mock
> provider, a small handler subset) for iterating on the UI without credentials. It is **not** the
> production daemon — `npm start` / `main.ts` / `bootstrap.ts` is.

## Tests, lint, typecheck

```bash
npm test            # run the full test suite (Vitest)
npm run typecheck   # tsc -b across all packages
npm run lint        # oxlint
npm run fmt:check   # oxfmt --check
```

Per-package tests run with `npx vitest run packages/<pkg>` (this repo has no vitest
`--project` workspace config).

## Project layout

```
packages/
  protocol/    wire schemas + shared protocol types (zero workspace deps)
  client/      low-level daemon WS driver + PiStudioClient SDK facade
  server/      the daemon (agents, terminals, git, projects, orchestration, relay transport)
  cli/         pi-studio terminal client + local daemon/relay lifecycle control
  highlight/   server-side syntax-highlight helper
  relay/       E2EE relay (channels, self-hosted server, Cloudflare Workers adapter)
  web-client/  production React/Vite browser UI
  desktop/     Electron wrapper (later sprint — placeholder)
swe/   specifications + the sprint implementation plan
```

Compile-time dependency graph:

```
protocol  ─────────────────────────────► (no workspace deps)
highlight ─────────────────────────────► (no workspace deps)
relay     ─────────────────────────────► (no workspace deps)
client    ──────► protocol, relay
server    ──────► protocol, highlight, relay
cli       ──────► protocol, client, relay  (+ resolves server/web-client paths, no runtime import)
web-client──────► protocol, client
```

The detailed specifications live under [`swe/`](swe/) —
[`MAIN-SCOPE.md`](swe/MAIN-SCOPE.md) is the entry point. Each package also has its own
`README.md` and `AGENTS.md`.
