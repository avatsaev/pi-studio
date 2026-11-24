# Task 003 — The local supervisor runs the app's binary

- **Sprint:** sprints/sprint-143-desktop-local-binary
- **Status:** done
- **Type:** feature
- **Area:** desktop (shell, engine, app)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
Every local action first makes sure the pinned binary is installed (S7), then runs
`$PI_STUDIO_HOME/bin/current/pi-studio`; the CLI search is removed; Update installs the pin and
restarts.

## Scope references
- `swe/features/single-binary-daemon.md` § The local entry, § Error handling & edge cases, D8, P11, S7
- `desktop/crates/shell/src/supervisor.rs`, `cli_find.rs` (removed), `services.rs` (a hook for the
  install crate), `shell_env.rs` (`PI_STUDIO_HOME` from the login shell), `daemons.rs`
- `desktop/crates/engine/src/local.rs` (`daemon.local.*`, the update rule)
- `desktop/apps/pistudiodesktop/src-tauri/src/services.rs`, `daemons.rs` (filling the hook)

## What to build
- `ensure_binary` as in the spec; progress applied at most every 250 ms as `Downloading`; then
  `Installing`; failures map to the new reasons.
- Start/restart/refresh/stop through the binary; after a start that reached `running`, prune to
  current + previous; the archive cache keeps only the pin.
- `Outdated { version }` for a running daemon below `minDaemonVersion`; `daemon.local.update`: stop
  (binary's `daemon stop`), install the pin, start; refused when the binary is at or above the pin and
  the daemon is not outdated (P11).
- Windows: `Unsupported` as today, no download.
- Delete `cli_find.rs` and its tests; adjust `secret_guard`, testkit and every caller.

## Out of scope
The page (task-004); the command-line tool (task-005).

## Acceptance criteria
- [ ] Supervisor tests with fake services: first use downloads then starts; a present pin starts
      without a download; a newer binary is kept; checksum failure → `failed(checksum_mismatch)` and
      nothing run; npm daemon running → `running` via the binary's status; outdated → Update path.
- [ ] `cargo xtask ci` green.

## Test / verification plan
- `cargo xtask ci`; the live run is sprint-145/task-001.

## Notes
The probe used to need only the CLI; now the first probe can take the download's time: the page shows
`downloading`, not a timeout.
