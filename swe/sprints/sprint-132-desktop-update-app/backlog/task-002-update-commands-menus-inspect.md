# Task 002 — `update.*` commands, the menu item, and the `boot` and `ui.inspect` parts

- **Sprint:** sprints/sprint-132-desktop-update-app
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/engine, desktop/crates/shell (menus, page, control)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
`update.check`, `update.install`, `update.restart` are registry commands with labels, `enabled` and
reasons; "Check for Updates…" is in the generated menus; `boot.update` and `ui.inspect.update` exist.

## Context / why
Spec § 3, § 4 (inspect fields), U10, P1, P18. Rule 3.

## Scope references
- `swe/features/desktop-self-update.md` § 3, § 4, U10
- New `desktop/crates/engine/src/update_cmds.rs` (+ tests), `crates/engine/src/commands.rs`
- `desktop/crates/shell/src/menus.rs` (Help menu on Linux/Windows; the macOS application-menu item is
  drawn by `src-tauri/src/menu.rs` in task-003), `crates/shell/src/page.rs` (`boot`),
  `crates/shell/src/control.rs` (`ui.inspect`)

## What to build
- The three commands per § 3; none takes params; refusals return their reason text.
- Menu model: a Help menu holding `update.check` (Linux, Windows); a flag the app binary reads to
  place the item in the macOS application menu.
- `boot` gains `update` (the state); `ui.inspect` gains `update: {state…, current, kind, checksEnabled,
  manifest, lastCheckAt?, lastError?}`. No path, URL other than the release page, or key.

## Out of scope
The plug-in calls and the dialog of U11 (task-003).

## Acceptance criteria
- [ ] `enabled` and reasons in each state, tested.
- [ ] `command.list` lists the three; the page's capability and command list are unchanged
  (`tests/secret_guard.rs` and the capability test still pass).
- [ ] `boot`/`ui.inspect` snapshots tested.

## Test / verification plan
- `cd desktop && cargo xtask ci`
