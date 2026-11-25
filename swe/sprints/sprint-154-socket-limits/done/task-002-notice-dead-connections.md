# Task 002 — The daemon notices a dead connection

- **Sprint:** sprints/sprint-154-socket-limits
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (ws server)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
A client that vanished without closing is removed within about a minute.

## Context / why
Finding T2. The server never pings, so a half-open direct connection stays a session until the kernel
gives up: it stays in the connected-clients list, keeps its subscriptions, and broadcasts are still
serialised for it. Relay sockets already have a 90 s silence timer and are not part of this task.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (sockets), § T2
- `packages/server/src/ws/ws-server.ts`, `observability/daemon-status-service.ts` (the clients list)
- Clients: `packages/client/src/daemon-client.ts` (JSON ping only), `desktop/crates/transfer`
  (its own 10 s / 30 s liveness), `desktop/crates/net` (the proxy forwards frames)

## What to build
- Every `PING_INTERVAL_MS = 30_000` the server sends a protocol-level ping on each direct socket. A
  socket that has shown no life (a pong or any frame) since the previous ping is terminated, which
  runs the normal session close (subscriptions disposed, removed from `daemon_status`).
- The timer is unref'd and cleared at shutdown. The JSON `ping`/`pong` messages stay as they are.

## Out of scope
Relay sessions. A client-side periodic ping.

## Acceptance criteria
- [ ] A client that completes `hello` and then never answers pings is gone within two intervals (short
      injected interval), and `daemon_status` no longer lists it.
- [ ] A normal `ws` client and the SDK's `DaemonClient` stay connected across many intervals.

## Test / verification plan
- `npx vitest run packages/server/src/ws packages/server/src/observability packages/client`
- `npm run build:server`

## Notes
Browsers and tungstenite answer protocol pings by themselves. Confirm it for the desktop proxy's
daemon socket in task-005, not here.
