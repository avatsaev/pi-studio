# Task 004 — Documents and spec close for milestone 3; `minDaemonVersion` (R1)

- **Sprint:** sprint-123-desktop-transfer-engine-close
- **Status:** done
- **Type:** docs
- **Area:** docs, swe, desktop
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The documents say what is built, the spec's status and criteria are final, and the app names the oldest daemon it supports.

## Context / why
Docs are deliverables. R1 removed the path for an older daemon, so the app's `minDaemonVersion` must name the release that carries the daemon changes of sprint 118.

## Scope references
- `swe/features/desktop-transfer-engine.md` (status, criteria, TODO(verify)), decision R1
- `docs/desktop-client-handoff.md` (status table, § 2, § Suggested milestones item 3, § Open questions), `swe/MAIN-SCOPE.md` (the index row, the TODO list), `swe/sprints/PLAN.md` (the sprint notes, coverage, open questions)
- `desktop/crates/shell/src/daemons.rs` (`min_daemon_version`), `desktop/crates/shell/src/page.rs` (its test), root `AGENTS.md` (the desktop paragraph, § Protocol overview), `desktop/AGENTS.md`, `desktop/README.md`

## What to build
- `min_daemon_version()` returns the release that carries sprint 118 (the next npm release after the branch merges; set it once that number is known, with its tests).
- The spec: status line, every criterion ticked or open with its reason, the TODO(verify) list answered or carried.
- The handoff: milestone 3's state, what milestone 4 can use (the engine's connection supplier is where a relay or an SSH stream would plug in), the open questions.
- `MAIN-SCOPE.md`, `PLAN.md` and the root and desktop `AGENTS.md` agree with what is built.

## Out of scope
- A release: tagging and merging need the owner's word.

## Acceptance criteria
- [ ] No document says "not built" about something built, or the reverse.
- [ ] `min_daemon_version` is set, or the task records that the release number is not known yet and leaves a dated note in the spec.
- [ ] `cargo xtask ci` and the root gates pass.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`; the root gates

## Notes
- The daemon changes must be released before, or with, the app that requires them.
