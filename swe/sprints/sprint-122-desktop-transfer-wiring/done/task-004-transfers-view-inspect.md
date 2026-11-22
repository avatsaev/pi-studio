# Task 004 — The transfers view and `ui.inspect` (D19, S10)

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
`ui.inspect` has a `transfers` section that an automated check can read.

## Context / why
The macOS runner has no WebDriver: `ui.inspect` is how a check sees what the app does (P10 of milestone 2). The 5 GiB check reads `peakHeld` here.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 8 (the shape), decisions D19, S10
- `desktop/crates/shell/src/transports.rs`, `services.rs` (`TransportsHook`), `control.rs` (`view`), `tests.rs`, `tests/secret_guard.rs`
- `desktop/docs/control-protocol.md` (`ui.inspect`)

## What to build
- Plain data types for the view of spec § 8 (`mode`, `connection { state, entryId, opens }`, `active[]`, `queued`, `totals`, `peakHeld`, `lastError`), serialised in camelCase; a hook in `Services` that the app fills; `ui.inspect` adds `transfers`.
- Without a hook: `mode` from task-001, a closed connection, empty lists, zeros, `lastError: null`.
- `control-protocol.md` documents the section and says what it never holds (a path, an address, a handle, a secret).

## Out of scope
- Filling the hook (task-005).

## Acceptance criteria
- [ ] `ui.inspect` returns the section with and without a hook, in the documented shape.
- [ ] The secret guard still passes with a hook that holds a marker path: the view type has no field a path could sit in.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`

## Notes
- `services.rs` in `shell` is also edited by task-002 (another hook): the second to land re-reads it.
