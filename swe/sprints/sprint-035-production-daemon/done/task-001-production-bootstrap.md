# Task 001 — Production daemon bootstrap (real provider + disk persistence)

- **Sprint:** sprint-035-production-daemon
- **Status:** done
- **Estimated size:** L
- **Depends on:** none (real modules already exist from sprints 004–010)

## Problem
`packages/server/src/daemon/main.ts` is a stub (prints one line, starts nothing) and
`bootstrap.ts` is empty. The only runnable bootstrap is `dev-bootstrap.ts` — **mock provider +
in-memory persistence**. We need a real production daemon that uses the **real Pi LLM provider** and
**disk persistence** under `PI_STUDIO_HOME` (`~/.pi-studio`, which already contains
`config.json` configuring the `pi` provider, `daemon-keypair.json`, `server-id`, and `agents/` etc.).

## Scope references
- `clean-room-scope/architecture/daemon-bootstrap.md`, `architecture/config.md`, `architecture/persistence.md`
- Existing modules to REUSE (do not rewrite): `daemon/dev-bootstrap.ts` (structure to mirror),
  `agent/provider-registry.ts` (`resolveProviderClient`), `agent/agent-manager.ts`,
  `persistence/entity-stores.ts` (`saveAgent`, `loadAllAgents`, config load), `config/daemon-config.ts`,
  `http/http-server.ts`, `ws/ws-server.ts`, `ws/router.ts`.

## What to build
- A `startDaemon(opts)` in `daemon/bootstrap.ts` mirroring `startDevDaemon` but:
  - **Config**: load `PersistedConfig` from `PI_STUDIO_HOME/config.json` (via `daemon-config.ts`).
  - **Provider**: `resolveClient = (providerId) => resolveProviderClient(providerId, config)` — real
    `pi` provider (spawns `pi --mode rpc`). Keep `mock` resolvable only when explicitly requested.
  - **Persistence**: `AgentManager` with `saveAgent: (r) => saveAgent(home, r)` and
    `loadAllAgents: () => loadAllAgents(home)`; recover agents on boot.
  - Keep the WS/HTTP wiring, session set holder, broadcast, ping/pong, capability rehydrate.
- Wire `main.ts` to call `startDaemon` with `createDaemonRuntimeInfo({ mode: "production" })`
  (host/port from `PI_STUDIO_LISTEN`, default `0.0.0.0:6767`), PID lock + server id + keypair from
  `~/.pi-studio` (reuse the identity module).
- Keep the same core handler registrations dev-bootstrap has (agent service, session ops, timeline,
  permissions, `list_providers`, file explorer). Registering the REMAINING handlers is task-002.

## Acceptance criteria
- [ ] `npm run build:server` succeeds.
- [ ] `node packages/server/dist/daemon/main.js` starts, binds `0.0.0.0:6767`, logs serverId + `provider: pi`.
- [ ] A client can `create_agent_request` with `provider: "pi"` against a real repo cwd and the
      daemon spawns `pi --mode rpc` (verify the process launches; a real prompt streams real tokens).
- [ ] Agents persist to `~/.pi-studio/agents/**` and reload after daemon restart.
- [ ] Existing server tests still pass (`npx vitest run packages/server`).

## Test / verification plan
- Unit: bootstrap wiring with an injected mock provider + temp `PI_STUDIO_HOME` (persistence round-trip).
- Manual: start daemon, use the client SDK to create a `pi` agent and send a prompt; confirm a real
  (non-echo) streamed assistant message.
