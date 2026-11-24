# Task 001 — Desktop: `daemon.local.update` — Summary

- **Sprint:** sprint-138-daemon-update-desktop
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Registry command (enabled for `cli_outdated` and `stopped`, refused with `unsupported`, `cli_missing`, `update_not_offered`, `busy`); supervisor: `updating`, `pi-studio update` (5 min), `--version`, then Start; ends `running`, `cli_outdated` or `failed(update_failed)` with the last 20 lines (2000 chars, control characters removed). New `run_checked` hook; `LocalState::Updating`, `FailReason::UpdateFailed`, `Failed { output }`.

## Files changed
`desktop/crates/{model/src/registry.rs,engine/src/local.rs,shell/src/{services,process,cli_answers,supervisor,daemons}.rs}`, tests, `apps/pistudiodesktop/src-tauri/src/services.rs`, `docs/{control-protocol,architecture}.md`

## Build & test results
```
Gate (combined tree): npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4516 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] enabled/refused per state; success, non-zero exit, still old, start fails, timeout, no hook; `command.list`.

## Follow-ups
- The page's `boot.ts` rejects unknown local states and `output`: 138/t003.
