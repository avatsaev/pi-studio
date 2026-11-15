# Task 002 — Daemon relay sessions — Summary

- **Sprint:** sprints/sprint-100-relay-daemon-sdk
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`packages/server/src/daemon/relay-sessions.ts`: `attachRelaySession(conn, deps)` with `deps = {registry, routeTextFrame, routeBinaryFrame, binaryHandler, capabilityStore, buildServerInfo, onSessionOpen, onSessionClose, logger}`. First text record must be a valid `hello` else `conn.close(1008, …)` with the direct path's reasons; capabilities from hello or the store; `Session` with `transport: "relay"` + platform/agentStreams/appVersion; `status`/`server_info` reply; socket facade (`bufferedAmount`, `readyState`, `close` forwarded); binary before hello dropped; `onSessionClose` once on connection close.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/relay-sessions.ts` | new |
| `packages/server/src/daemon/relay-sessions.test.ts` | new (8 tests) |
| `packages/server/AGENTS.md` | layout entry |

## How it satisfies the scope
relay-protocol § 5; Public contract 2; D8, S8. Terminal attachments: a direct close does nothing terminal-specific (lazy release via `Session.isOpen`), so no extra disposal list was added.

## Build & test results
```
$ npx vitest run packages/server/src/daemon/relay-sessions.test.ts -> 8 passed
$ npm run build:server -> success; oxfmt/oxlint clean
```

## Acceptance criteria
- [x] valid hello → one relay session + server_info, later record routed; invalid first record → 1008, no session; facade parity; two independent sessions; stored capabilities reused

## Follow-ups / TODO(verify)
- task-003 wires it into bootstrap (`relaySessions` add/remove through onSessionOpen/onSessionClose) and rewrites the invariant docs.
