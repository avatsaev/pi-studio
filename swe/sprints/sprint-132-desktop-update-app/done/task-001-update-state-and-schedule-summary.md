# Task 001 — The setting, the update state machine, the schedule and the `Services` hook — Summary

- **Sprint:** sprint-132-desktop-update-app
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `Settings.check_for_updates` (`checkForUpdates`, absent = true), settable by `settings.set`; the engine's rollback tuple and `settings.set`'s report include it (storage.rs, settings_cmds.rs), with a rollback test.
- `crates/shell/src/update.rs`: `UpdateState` (eight variants), `UpdateCode`, `Reason`, `InstallKind`, `Refusal`; `UpdaterHook` in `Services::updater` (`check`, `install_kind`, `cannot_install`, `download`, `install`, `restart`); `Updater` with quick `begin_*` and blocking `run_*` (the app calls these off the owner thread); the schedule `due(trigger, enabled, last_check_ms, now_ms)`; silent automatic failures; P14; throttled progress; `state_json()` and `inspect()`.
- 29 tests in `update/tests.rs`, schedule on a fake clock.

## Files changed
`crates/model/src/lib.rs`, `crates/engine/src/{storage.rs,settings_cmds.rs}`, `crates/shell/src/{update.rs,update/tests.rs,lib.rs,services.rs,tests.rs}`, `crates/shell/Cargo.toml` (`log` no longer native-only), `src-tauri/src/{services.rs,control_server.rs,commands/tests.rs}`, `desktop/AGENTS.md`, `docs/{architecture,control-protocol}.md`

## Build & test results
```
Wave gate (combined tree): cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; npm run build, typecheck ok; npm run lint 0 errors; npm test -> 299 files / 4280 tests passed
```

## Acceptance criteria
- [x] Every transition, code and reason, P14, P16 on a fake clock, automatic vs manual failure; the setting reads true when absent and keeps unknown keys.

## Follow-ups
- The wake signal and the hourly tick are not wired: 132/t003 must call `scheduled(Trigger::Elapsed, ...)` on the tick and the wake and `Trigger::Launch` once (the 5 s resume rate limit must not gate it).
- The close question (P10) is asked by the caller before `restart()`: 132/t004.
- A concurrent check is a refusal (`Refusal::Checking`); the spec's `enabled` row did not say.
- 132/t002's engine needs its own view of the state (engine cannot use shell types).
