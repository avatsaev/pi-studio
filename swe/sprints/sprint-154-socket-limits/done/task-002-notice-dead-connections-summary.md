# Task 002 — The daemon notices a dead connection — Summary

- **Sprint:** sprints/sprint-154-socket-limits
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
New `ws/liveness.ts`: `watchLiveness(wss, intervalMs, logger?)` sends `ws.ping()` to every open direct socket each `PING_INTERVAL_MS` (30 s, in `limits.ts`; `deps.pingIntervalMs` for tests); a socket that showed no life since the previous ping (a pong, a ping from the peer, or any message) is terminated, which runs the normal close path (removed from `daemon_status`, subscriptions disposed). The timer is unref'd and cleared by `close()`. A socket the server has paused reading (upload back-pressure) is neither pinged nor judged, so a healthy client on a slow-disk upload is not killed (a mutation test shows the omission is caught). Each kill logs a warn line. Relay sessions are unchanged (their own silence timer).

## Files changed
`packages/server/src/ws/{liveness,limits,ws-server}.ts`, `ws-server.test.ts` (new "liveness" describe), new `packages/cli/src/ping-liveness-sdk-e2e.test.ts` (the SDK's `DaemonClient` over six intervals; in `cli` because only it depends on both client and server); docs `packages/server/AGENTS.md`, `README.md`, root `AGENTS.md`.

## Build & test results
```
npx vitest run packages/server/src/{ws,observability} packages/client packages/cli/src/ping-liveness-sdk-e2e.test.ts -> 18 files, 396 passed; build:server OK; oxlint/oxfmt clean
```

## Acceptance criteria
- [x] A client that completes `hello` and never answers pings is gone within two intervals and absent from `daemon_status`
- [x] A normal `ws` client and the SDK's `DaemonClient` stay connected across six intervals

## Follow-ups / TODO(verify)
- Read, not run: browsers answer protocol pings below JS [INFERENCE]; the desktop proxy's daemon leg answers them (tungstenite queues the pong, `proxy/pump.rs`, a flow test) but only while the page leg keeps up: a page that stops reading for two intervals is reconnected (acceptable); the transfer crate counts a ping or pong as proof of life. Sprint-154/task-005 checks a real daemon through the proxy for over 60 s.
