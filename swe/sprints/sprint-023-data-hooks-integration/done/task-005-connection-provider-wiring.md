# Task 005 — Connection provider & app-level wiring

- **Sprint:** sprint-023-data-hooks-integration
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** tasks 001–004

## Goal
Wire the connection provider (from sprint-017) to actually connect to the daemon, drive the session
store from real WS events, and make the boot gate route users to the correct screen based on
connection state.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § boot sequence, § connection provider
- `clean-room-scope/architecture/daemon-bootstrap.md` § hello handshake

## What to build
- **Connection provider enhancement**: on app start, attempt to connect to the configured daemon
  address (from KV store or `PI_STUDIO_LISTEN` env). Drive the boot gate: no-hosts → Welcome;
  connecting → splash/loading; connected → Home/last-workspace.
- **Event subscription**: once connected, subscribe to all agent broadcasts; populate the session
  store; subscribe to server-info updates.
- **Auto-reconnect**: exponential backoff on disconnect; show a toast on connection loss; suppress
  stale-data UI during reconnect window.
- **Multi-host**: support connecting to multiple daemons simultaneously; aggregate in cross-host
  screens; show per-host status in sidebar.
- **AppProviders update**: inject `PiStudioClient` instance into React context; make it accessible
  via `useClient()` hook for all query/mutation hooks.

## Acceptance criteria
- [ ] App connects to a running daemon on startup and shows real sessions in the Home screen.
- [ ] Disconnection shows toast + reconnect; reconnection re-subscribes without data loss.
- [ ] Boot gate routes correctly: no hosts → Welcome; connected → Home.
- [ ] Multi-host: can add a second host and see sessions from both in the cross-host Sessions screen.

## Test / verification plan
- Integration test: start mock WS server → app connects → verify store populated.
- Reconnect: disconnect mock → verify toast + backoff → reconnect → verify re-subscribe.
- Boot gate: no stored hosts → lands on /welcome; one host → lands on /.
