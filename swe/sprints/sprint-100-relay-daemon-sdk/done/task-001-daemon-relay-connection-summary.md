# Task 001 — Daemon RelayConnection — Summary

- **Sprint:** sprints/sprint-100-relay-daemon-sdk
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`packages/server/src/daemon/relay-connection.ts`: `openRelayConnection({url, sessionId, connectionId, keypair, limits?, logger})` → pinned `RelayConnection` (`bufferedAmount`, `isOpen`, `sendText/sendBinary`, `close(code, reason)`, `onText/onBinary/onClose`). Dials with maxPayload 100 MiB, sends `relay_daemon_attach`, waits `relay_paired`, runs `createDaemonChannel` over a byte Transport. Timers: attach, key exchange (close 4100), silence 90 s reset by frames and pings (close 4108). `onClose` fires once. `RelayConnectionLimits` type exported.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/relay-connection.ts` | new |
| `packages/server/src/daemon/relay-connection.test.ts` | new (7 tests, real relay server) |
| `packages/server/AGENTS.md` | layout entry |

## How it satisfies the scope
relay-protocol § Behavior — Daemon (data socket). Deviations: caller passes a finished URL (no `relayUrl` reuse needed); timeout close codes 4100/4108 chosen (spec silent); sends while not open are dropped silently; `close()` fires `onClose` immediately.

## Build & test results
```
$ npx vitest run packages/server/src/daemon/relay-connection.test.ts -> 7 passed
$ npm run build:server -> success
$ wave gate (full tree): npm run build && npm run typecheck -> success; npm run lint -> no errors; npm test -> 273 files, 3879 passed (fmt:check issues are pre-existing, none in changed files)
```

## Acceptance criteria
- [x] ordered text+binary both ways; bufferedAmount rises (>1 MiB) while paused and drains; close(1008,"invalid hello") reaches client; key-exchange timeout closes once; client close forwarded; unknown id → 4106; plus silence timeout test

## Follow-ups / TODO(verify)
- Timeout close codes 4100/4108 are implementer choices.
