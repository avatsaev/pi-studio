# Task 006 — Dev daemon: a scripted update for UI work — Summary

- **Sprint:** sprint-136-daemon-update-service
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `PI_STUDIO_DEV_UPDATE=available|cannot|fail|rollback` (`update/dev-update-script.ts`, `dev-bootstrap.ts`); unset: kind `source`, nothing newer. `available`/`rollback`: three 1.5 s steps, then sessions closed with 1001 and a fresh service takes over in the same process on the same port (9.9.9 / back on the old version, `lastResult`). Options `updateScript` and `updateStepMs`.

## Files changed
`packages/server/src/update/dev-update-script.ts`, `packages/server/src/daemon/{dev-update-script.test.ts,dev-bootstrap.ts}`, `packages/server/AGENTS.md`, root `AGENTS.md`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] each script driven over a real socket by a test.

## Follow-ups
- `/api/health` still reports the real version after a scripted update (hardcoded in `http-server.ts`).
