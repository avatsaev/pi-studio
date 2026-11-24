# Task 001 — Protocol: the `daemon_update_*` family and the `daemonUpdate` flag — Summary

- **Sprint:** sprint-136-daemon-update-service
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Schemas in `messages.ts` (session union members, `.passthrough()`): status/check/apply/set_auto_check request and response pairs, `daemon_update_status_push` (the broadcast), `DaemonUpdateStatus` with a closed discriminated `state.kind` (10 variants); an unknown kind or `installKind` is rejected.
- `SERVER_FEATURES.daemonUpdate` with `COMPAT addedIn 0.0.130`; no external fixture (said in `packages/protocol/AGENTS.md`).

## Files changed
`packages/protocol/src/{messages.ts,client-capabilities.ts,client-capabilities.test.ts,daemon-update.test.ts}`, `packages/protocol/AGENTS.md`

## Build & test results
```
Wave gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 304 files / 4318 tests passed; cd desktop && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] round-trips of every state kind and message (5 tests); unknown kind rejected; capability list test; external fixtures guard passes.

## Follow-ups
- Message names chosen here: `daemon_update_set_auto_check_response`, `daemon_update_status_push` (the spec named the request and the broadcast only).
- The flag has its own row in `AGENTS.md`.
