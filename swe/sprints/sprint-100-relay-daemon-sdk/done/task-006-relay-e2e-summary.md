# Task 006 — End to end: SDK ↔ real relay ↔ real daemon — Summary

- **Sprint:** sprints/sprint-100-relay-daemon-sdk
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`packages/cli/src/relay-e2e.test.ts` (6 cases): real `startRelayServer` (port 0) + production `startDaemon` (temp home, `daemon.relay`), pairing URL from the daemon key, clients via `parsePairingUrl` → `createRelayTransport` → `DaemonClient` with a frame-recording `ws` factory. Cases: two simultaneous clients (distinct relay sessions in `daemon_status`, one closes, other works); 32 cap (30 raw sockets + 2 SDK, 33rd → `too_many_clients`, re-admitted after one leaves); 64 MiB download + upload with SHA-256 match while a second client answers `list_agents_request`; binary-only wire after pairing; daemon stopped → `daemon_offline` <1 s; pairing link from before a daemon restart connects (D14).

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/src/relay-e2e.test.ts` | new (6 tests, ~3.4 s) |

## Build & test results
```
$ npx vitest run packages/cli/src/relay-e2e.test.ts (x5) -> 6 passed each
$ orchestrator gate: npm run build && typecheck -> success; npm test -> all passed
```

## Acceptance criteria
- [x] all cases pass deterministically in <60 s; afterEach cleans relay, daemon, temp home, files

## Follow-ups / TODO(verify)
- 600 MiB + memory proof is s101/t001. Docs: test-only, nothing documented changed.
