# Task 002 — `update.*` commands, the menu item, and the `boot` and `ui.inspect` parts — Summary

- **Sprint:** sprint-132-desktop-update-app
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Engine `update_cmds.rs`: `update.check|install|restart` (no params, `{accepted:true}`), gated by an `UpdateGate` the shell sets from the live `UpdateState` (`Session::set_update_gate`), accepted actions queued (`take_update_requests`) and delivered through the new `Notify::update` after each request in `owner::serve_notifying`; a second click while an action is queued is refused.
- Shell: `AppShell::sync_update_gate`, Help menu with `update.check` (`in_application_menu` tells the app to draw it in the macOS application menu), `boot.update`, `ui.inspect.update`; `PAGE_COMMANDS` gained the three ids (the Tauri command list and capability are unchanged).
- Docs: `desktop/AGENTS.md`, `docs/control-protocol.md`.

## Files changed
`crates/engine/src/{update_cmds.rs,update_cmds/tests.rs,session.rs,lib.rs,commands.rs}`, `crates/shell/src/{menus.rs,page.rs,control.rs,daemons.rs,owner.rs,lib.rs,tests.rs}`, `apps/pistudiodesktop-cli/tests/cli.rs`, `desktop/AGENTS.md`, `docs/control-protocol.md`

## Build & test results
```
Wave gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed (after fixing one oxlint error in update-manifest.mjs and the CLI's command-list test); root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4280 tests passed; node --test 'scripts/release/*-test.mjs' -> 21 passed
```

## Acceptance criteria
- [x] enabled/reasons per state (table of 9 states); command.list lists three; capability and page command list unchanged; boot/inspect snapshots.

## Follow-ups
- Until 132/t003-t004 implement `Notify::update` in the app, an accepted command only queues. `control-protocol.md` already says the check runs in the background.
- The spec said the page-command list does not change: only the Tauri one doesn't; `PAGE_COMMANDS` gains the ids.
