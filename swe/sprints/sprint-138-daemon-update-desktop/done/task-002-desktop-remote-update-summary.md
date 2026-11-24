# Task 002 — Desktop: `daemon.remote.update` over SSH — Summary

- **Sprint:** sprint-138-daemon-update-desktop
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Registry command for SSH entries (enabled for `cli_outdated` and `stopped`); `pi-studio update 2>&1` over SSH (300 s), `--version`, then Start; `RemoteState::Updating`, `RemoteFailReason::UpdateFailed`, `Failed { reason, output }`; the page reconnects after a successful update; on `PAGE_COMMANDS`.

## Files changed
`desktop/crates/{model/src/registry.rs,engine/src/remote.rs,engine/src/remote/tests.rs,shell/src/{remote_supervisor.rs,remote_supervisor/tests.rs,daemons.rs,tests.rs}}`, `apps/pistudiodesktop-cli/tests/cli.rs`, `src-tauri/src/daemons.rs`, docs

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] success, non-zero exit, still outdated, timeout with the fake SSH runner.

## Follow-ups
- `RemoteOutput` stays stdout-only (stderr merged with `2>&1`).
- 138/t003 needs `host/daemons.ts` to parse `{state:"updating"}` and `{state:"failed", reason:"update_failed", output?}` and an `update` call.
