# Task 002 — Client SDK: daemon update methods and subscription — Summary

- **Sprint:** sprint-136-daemon-update-service
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `PiStudioClient`: `hasDaemonUpdateCapability`, `getDaemonUpdateStatus`, `checkDaemonUpdate` (30 s timeout), `applyDaemonUpdate` (a refusal resolves `{ok:false,error}`), `setDaemonUpdateAutoCheck`, `onDaemonUpdateStatus` (unsubscribe). Scripted daemon handlers for tests.

## Files changed
`packages/client/src/{pistudio-client.ts,pistudio-client.test.ts,test-support/scripted-daemon.ts}`, `packages/client/AGENTS.md`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] wire message per request, capability with and without the flag, timeout, refusal, subscription and its removal.

## Follow-ups
None.
