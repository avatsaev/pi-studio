# Task 002 — The remote supervisor installs and runs the binary on an SSH host

- **Sprint:** sprints/sprint-144-desktop-ssh-install
- **Status:** backlog
- **Type:** feature
- **Area:** desktop (model, engine, shell, app)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-143/task-003

## Goal
The probe reads the host's facts; `daemon.remote.install` downloads (or reuses) the archive, sends it,
checks, unpacks, starts; every command runs the binary by its absolute path; the states follow R7.

## Scope references
- `swe/features/desktop-ssh-daemon-install.md` (all of Behavior, R1–R9, Error handling)
- `desktop/crates/model/src/registry.rs` (`RemoteState`, `RemoteFailReason`)
- `desktop/crates/engine/src/remote.rs` (commands), `desktop/crates/shell/src/remote_supervisor.rs`,
  `services.rs` (a send hook beside `remote_run`), `desktop/apps/pistudiodesktop/src-tauri/src/ssh_session.rs`
- The archive cache of `pistudiodesktop-install` (sprint-143/task-002)

## What to build
- Facts script (one `run`): `uname -s`, `uname -m`, musl check with streams merged, the host folder
  (`${PI_STUDIO_HOME:-$HOME/.pi-studio}`), the binary's `--version` or none.
- Probe, install, update and start as in the spec; the check script (size, SHA-256 when a tool
  exists); the unpack script (R5); prune after a start.
- `RemoteState` R7; `update_failed` and the `pi-studio update` path removed; `cli_outdated` → `outdated`.
- Progress applied at most every 250 ms.

## Acceptance criteria
- [ ] Supervisor tests with a fake host: each target mapping and unsupported case; install happy path
      with stage order; each failure state; a present version only switches the link; a newer binary is
      started, not replaced; a running daemon is `running` with no install offered.
- [ ] `cargo xtask ci` green.

## Test / verification plan
- `cargo xtask ci`

## Notes
Host output never reaches a log; only the last lines reach the state for `install_failed`/`send_failed`.
