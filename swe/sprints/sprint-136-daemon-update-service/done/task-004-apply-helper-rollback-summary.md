# Task 004 — Daemon: apply, the helper, restart and rollback — Summary

- **Sprint:** sprint-136-daemon-update-service
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `createUpdatePipeline` in `update-service.ts`: install (`failed` with code `permission|timeout|network|install` and a redacted tail, no restart), `updateInstalledExtensions` (failure logged, goes on), helper spawn, 300 ms pause, shutdown, exit; a second apply is refused `in_progress`.
- `update/helper.ts`: a self-contained script (Node built-ins only, asserted) and the same logic as a function with injected seams: wait for the old process (30 s), three tries with a health check on the target version, rollback to the previous version, `update-result.json`, `logs/update-restart.log`; the entry is found under the hoisted or the cli-nested layout by matching `package.json` version.
- `daemon/run.ts` `runDaemon`: fatal exit, SIGINT/SIGTERM close then exit, `onUpdateRestart`; `main.ts` and the CLI's starter (`daemonStartScript`) use it, so a CLI-started daemon can update itself and `daemon stop` closes cleanly.
- `daemonUpdate` advertised on the direct and relay paths (one shared map).

## Files changed
`packages/server/src/update/{helper.ts,update-service.ts,npm.ts}` (+tests), `packages/server/src/daemon/{run.ts,run.test.ts,bootstrap.ts,main.ts,index.ts,update-e2e.test.ts}`, `packages/server/src/extensions/{sync-executor.ts,sync-executor.test.ts}`, `packages/cli/src/{daemon-control.ts,daemon-start-script.test.ts}`, docs

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] install failure, extensions failure, helper outcomes (updated / rolled_back / failed with the log line), in_progress, flag advertised, handoff end to end with fakes and on the real bootstrap; the real helper script run against a fake npm and fake daemon.

## Follow-ups
- Entry lookup picks the layout whose `package.json` version matches the target (spec: hoisted then nested).
- A daemon started without `onUpdateRestart` fails the apply before installing.
- Real npm and a real restart are untested here: 136/t005.
