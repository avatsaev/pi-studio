# Task 001 — `--transfers <engine|page>` and `boot.transfers` (D18, S4)

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
A launch can turn the engine off, and the page knows which path the run uses.

## Context / why
D18: a way back to the page's path without a setting in the UI. It is also how the 5 GiB check compares the two paths on one build.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 1, decisions D18, S4
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs` (`Args`, `--secret-store`), `desktop/crates/shell/src/secret_choice.rs` (`Preference`: the shape of a parsed option), `desktop/crates/shell/src/page.rs` (`boot`)
- `desktop/apps/pistudiodesktop/src/host/boot.ts` (`parseBootSnapshot`), `boot.test.ts`
- `desktop/docs/control-protocol.md` (the launch options), `desktop/docs/architecture.md` (the `boot` row)

## What to build
- A two-valued mode, `engine` (default) or `page`, parsed from `--transfers`; an unknown value fails the launch naming the option. No environment variable.
- `boot` answers `transfers: "engine" | "page"`. `parseBootSnapshot` requires the field (R1: no tolerance for an older app) and rejects any other value.
- The mode is kept where the commands of task-002 and task-005 and the view of task-004 can read it.
- The two documents name the option and the field.

## Out of scope
- Any behaviour that depends on the mode (later tasks).

## Acceptance criteria
- [ ] `--transfers page` gives `boot.transfers === "page"`; no option gives `engine`; `--transfers fast` fails the launch with a message that names `--transfers`.
- [ ] A boot snapshot without the field, or with another value, is rejected by `parseBootSnapshot`.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo clippy -p pistudiodesktop-shell -p pistudiodesktop --all-targets -- -D warnings`
- `cargo xtask ci` in `desktop/`
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)`

## Notes
- `boot.ts` is also read by task-006: this task lands first.
