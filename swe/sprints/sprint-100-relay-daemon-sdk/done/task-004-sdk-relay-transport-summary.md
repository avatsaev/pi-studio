# Task 004 — SDK relay transport on protocol 2 — Summary

- **Sprint:** sprints/sprint-100-relay-daemon-sdk
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`packages/client/src/relay-transport.ts` rewritten: `createRelayTransport` sends `relay_client_connect`, waits `relay_paired`, runs `createClientChannel` over a byte adapter (`binaryType = "arraybuffer"`), `connectTimeoutMs` (default 15 000), `RelayConnectError` with `reason` (`daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_outdated`, `wrong_key`, `timeout`, `relay_unreachable`, `protocol_error`) and spec-table messages. Channel failure → `onError` then `onClose` 4200; daemon-forwarded closes keep code/reason. Legacy import removed from the client.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/relay-transport.ts` | rewritten |
| `packages/client/src/relay-transport.test.ts` | rewritten (21 tests, real relay + stand-in daemon) |
| `packages/client/AGENTS.md`, `README.md` | relay sections rewritten |
| `packages/client/src/pairing.ts` | doc comment |

## How it satisfies the scope
§ Behavior — Client; § Public contract 3. Deviations: 4200 between paired and ready → `wrong_key`; transport single-use; `close()` while connecting rejects `protocol_error`; `new Promise` kept for older runtimes.

## Build & test results
```
$ npx vitest run packages/client -> 11 files, 237 passed
$ npm run build:client -> success
$ wave gate (full tree): npm run build && npm run typecheck -> success; npm run lint -> no errors; npm test -> 273 files, 3879 passed (fmt:check issues are pre-existing, none in changed files)
```

## Acceptance criteria
- [x] round trip incl. ArrayBuffer; offline <1 s; unresponsive via injected attach timeout; too_many_clients with injected cap of 2 (real 33rd case runs in s100/t006); outdated; wrong_key with nothing delivered after hello; timeout; unreachable; tamper → onError+4200; every message content asserted

## Follow-ups / TODO(verify)
- relay README wire-protocol text is rewritten in s101/t002.
