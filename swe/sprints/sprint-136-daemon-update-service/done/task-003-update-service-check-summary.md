# Task 003 — Daemon: the update service (state, check, timer, setting, result file) and its handlers — Summary

- **Sprint:** sprint-136-daemon-update-service
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `update/update-service.ts` (state machine with injected seams, 6 h unref'd timer cleared in `close()`, single flight, result-file read-and-remove at start, lazy install-kind probe `ready()`), `update/update-rpc.ts` (four handlers), `config/daemon-config.ts` (`daemon.update.autoCheck`, env `PI_STUDIO_UPDATE_AUTOCHECK` wins, `persistUpdateAutoCheck`), wired in `bootstrap.ts` (status sent after `server_info` on the direct and relay paths).
- A failed automatic check changes nothing a user sees; a manual one records `checkError`.

## Files changed
`packages/server/src/update/{update-service.ts,update-rpc.ts}` (+tests), `packages/server/src/daemon/{bootstrap.ts,update-e2e.test.ts}`, `packages/server/src/config/{daemon-config.ts,daemon-config.test.ts}`, root `vitest.config.ts`, docs

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] every Check state, all cannot_update reasons, both checkError values; timer armed only with autoCheck and cleared once; setting default/env/RPC; status after server_info.

## Follow-ups
- Root `vitest.config.ts` sets `PI_STUDIO_UPDATE_AUTOCHECK=false` so no test daemon runs a real `npm view`.
- A non-boolean `enabled` is an `rpc_error`.
