# Task 004 — Relay server protocol 2 — Summary

- **Sprint:** sprints/sprint-099-relay-protocol-primitives
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`startRelayServer({host, port, logger, limits?})` rewritten: control sockets, pairing of one client with one daemon data socket, refusals 4100–4107, parking of old-protocol `relay_register` sockets (S9 rule isolated in `looksLikeOutdatedDaemon`), close forwarding (forwardable codes verbatim, otherwise `4109 peer_closed`), identify/attach timers, 32-client cap, `maxPayload` 100 MiB, per-pair summary log. Handle: `{host, port, counts(), close()}`. `session-bridge.*` and `cf-adapter.*` deleted.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/relay-server.ts`, `relay-server.test.ts` | rewritten (35 tests) |
| `packages/relay/src/session-bridge.ts`/`.test.ts`, `cf-adapter.ts`/`.test.ts` | deleted |
| `packages/relay/src/index.ts` | two exports removed |
| `packages/relay/AGENTS.md`, `README.md` | server + removed-modules sections rewritten |

## How it satisfies the scope
relay-protocol.md § 1–3, Behavior — Relay (except flow control/pings/shutdown → t005). Deviations: `close()` terminates sockets (t005 replaces with 1001); an abnormal close (1005/1006) of one half reaches the other as 4109.

## Build & test results
```
$ npx vitest run packages/relay/src -> 83 passed
$ npm run build:relay && npm run build:cli -> success
$ wave gate: npm run build && typecheck && lint (no errors) && npm test -> 271 files, 3830 passed
```

## Acceptance criteria
- [x] all nine criteria (register/dial/paired; two independent clients; each of 4100–4107 incl. cap re-admission; close forwarding incl. 1008/4000 and 4109; parking + S9; control replacement keeps pairs; 1009 oversize; deletions; relay-main + /health) — covered by named tests

## Follow-ups / TODO(verify)
- S9 awaits owner confirmation. Stale comments naming RelaySessionBridge in server/cli are out of scope (cleaned in s100/s101).
