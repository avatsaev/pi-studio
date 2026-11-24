# Task 002 — Desktop: `daemon.remote.update` over SSH

- **Sprint:** sprints/sprint-138-daemon-update-desktop
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell (remote_supervisor), engine
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
An SSH entry has the same Update action, run over its SSH connection.

## Context / why
Spec § Desktop (D9, P12).

## Scope references
- `swe/features/self-update.md` § Desktop
- `desktop/crates/shell/src/remote_supervisor.rs` (+ tests), `desktop/crates/engine/src/daemon_cmds.rs` or where `daemon.remote.start` lives, `daemons.rs`, `desktop/crates/model` (`RemoteState::Updating`)
- `desktop/docs/control-protocol.md`

## What to build
- `daemon.remote.update {id}`: enabled for `cli_outdated` and stopped states of an SSH entry; runs `pi-studio update` on the host (5 min), `--version`, then the existing start.
- `not_installed` stays without Update.

## Out of scope
The screen (task-003).

## Acceptance criteria
- [ ] Tests with the fake SSH runner: success, non-zero exit, still outdated, timeout.

## Test / verification plan
- `cd desktop && cargo fmt --all && cargo xtask ci`

## Notes
None.
