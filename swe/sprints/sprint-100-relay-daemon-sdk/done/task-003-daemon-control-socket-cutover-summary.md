# Task 003 — Daemon control socket + bootstrap cutover — Summary

- **Sprint:** sprints/sprint-100-relay-daemon-sdk
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`relay-transport.ts` rewritten: `connectRelay(keypair, config, {onConnection, logger, limits?, random?, timers?})` keeps one protocol-2 control socket (register, 10 s registration answer, 90 s silence check, backoff 1→30 s ±20 % reset by `relay_registered`, 30 s wait after 4107, 32-socket cap with ignored+logged extra dials, unknown frames ignored); `close()` closes the control socket and every data connection. `bootstrap.ts` serves each connection through `attachRelaySession`; single `relaySession`, reply callbacks, `onHandshake`/`onReconnect` and the "relay peer replaced" path removed. `relaySessions` kept for `getActiveSessions`. Stale RelaySessionBridge comments cleaned (`ws/session.ts`).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/relay-transport.ts` / `.test.ts` | rewritten (real relay server, injected timers; 10 tests) |
| `packages/server/src/daemon/bootstrap.ts` / `.test.ts` | relay block replaced; relay tests ported to the real relay server |
| `packages/server/src/ws/session.ts` | comments |
| `packages/server/AGENTS.md`, `README.md` | relay sections rewritten |

## How it satisfies the scope
relay-protocol § Behavior — Daemon; D15, D17, S5, S6. Existing sprint-084/098 relay coverage ported, not dropped.

## Build & test results
```
$ npm run build && npm run typecheck -> success
$ npx oxlint / oxfmt --check on changed server files -> clean
$ npm test -> 274 files, 3896 passed
```

## Acceptance criteria
- [x] register + onConnection; backoff spacing and reset; outdated relay → one log + backoff; 4107 replaced delay with open connection kept; silence replacement; cap of 2 ignores 3rd dial; two simultaneous clients with independent sessions in `daemon_status`; closing one disposes only its session; invalid first message → 1008; numeric `bufferedAmount` — covered in relay-transport.test.ts and bootstrap.test.ts

## Follow-ups / TODO(verify)
- Subagent's last four small edits (for…of, toSorted, log wait, docs) were verified by the orchestrator's full gate above.
