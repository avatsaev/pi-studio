# Task 001 — Desktop: `daemon.local.update`

- **Sprint:** sprints/sprint-138-daemon-update-desktop
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/engine, desktop/crates/shell
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-135/task-004

## Goal
The local entry has an Update action that runs `pi-studio update`, reads the version again and starts the daemon.

## Context / why
Spec § Desktop (D9, P12). Offered when the local state is `cli_outdated` or stopped.

## Scope references
- `swe/features/self-update.md` § Desktop
- `desktop/crates/engine/src/local.rs` (+ tests), `desktop/crates/shell/src/supervisor.rs`, `cli_answers.rs`, `daemons.rs` (page command list), `desktop/crates/model/src/registry.rs` (`LocalState::Updating`)
- `desktop/docs/control-protocol.md`, `desktop/AGENTS.md`

## What to build
- Command `daemon.local.update` (registry command, enabled when `cli_outdated` or `stopped`; refused with a reason otherwise).
- Supervisor: `pi-studio update` with a 5 min limit, output not parsed, its last lines kept for a failure (no secret in them is expected; pass them through the existing redaction if one exists); then `--version`; then start.
- States: `updating` → `running` | `failed(update_failed)` | `cli_outdated` (still below the minimum).

## Out of scope
SSH entries (task-002). The screen (task-003).

## Acceptance criteria
- [ ] Engine tests for enabled/refused per state; supervisor tests with the fake CLI runner: success, update exits non-zero, version still old, start fails.
- [ ] `command.list` lists it.

## Test / verification plan
- `cd desktop && cargo fmt --all && cargo xtask ci`

## Notes
No unwrap/panic in non-test code.
