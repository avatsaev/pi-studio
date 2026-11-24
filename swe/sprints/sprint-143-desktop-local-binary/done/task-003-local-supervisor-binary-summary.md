# Task 003 — The local supervisor runs the pinned binary — Summary

- **Sprint:** sprint-143-desktop-local-binary
- **Completed:** 2026-11-24
- **Status:** done

## What was built
- `ensure_binary` (S7) before every local request: a binary at or above the pin is used as is (a newer one is kept, P11); else adopt `versions/<pin>` if present (`install::switch_current`, now `pub`, rejects a non-plain version name, 1 new test), else download (`downloading`, stored at most every 250 ms) then `installing`. Failures: `download_failed`; `checksum_mismatch` (nothing run, archive deleted); `install_failed` (with output); a bad `PI_STUDIO_HOME` is `install_failed`. Windows stays `unsupported`, no download.
- After a Start/Restart/Update that reached `running`: prune to current + previous; archive cache keeps only the pin.
- A running daemon below 0.0.127 is `outdated{version}` (version from `GET /api/health`, since `daemon status` has none); `daemon.local.update` stops it, installs the pin, starts; refused when the binary is at or above the pin and the daemon is not outdated. An npm daemon already running is reported `running` via the binary's `status`. `daemon_resolve_current` waits from the last sign of life so a long download is not a timeout. The headless CLI app has no installer: a missing binary is `failed(spawn_failed)`.
- Code: `crates/shell` (`services.rs` loses `run_checked`/`is_executable`/`list_dir`, gains the `Installer` trait and `daemon_version`; `supervisor.rs` rewritten, 33 tests with a `FakeInstaller`; `cli_find.rs` deleted; `process.rs`, `shell_env.rs`, `cli_answers.rs`, `daemons.rs`, `owner_access.rs`), `crates/engine/src/local.rs` (`apply_local_progress`), app `src-tauri/src/daemon_install.rs` (real installer, 8 tests incl. a loopback checksum-mismatch end to end) and `daemon_health.rs` (4 tests), `apps/pistudiodesktop-cli`; macOS and Windows platform-check scripts adjusted (cannot run here); docs: `desktop/AGENTS.md`, `docs/{architecture,control-protocol,development,platform-checks}.md`.

## Results
Narrow: shell 287 + secret_guard, engine 96, install 51, model 50, app 253 (+4, +5), cli 9; clippy `-D warnings` clean; `cargo xtask layers` ok; platform-check vitest 135. Wave gate: `cargo xtask ci` 8/8 (see sprint report).

## Acceptance
- [x] Supervisor tests: first use downloads then starts; present pin starts without download; newer binary kept; checksum failure → `failed(checksum_mismatch)` and nothing run; npm daemon running → `running` via status; outdated → update path. [x] `cargo xtask ci`.

## Not run / follow-ups
macOS/Windows script edits only syntax-checked; no real-network run (145/001); the long workspace-map lines in `desktop/AGENTS.md` for shell/engine/install do not list the new `Installer`/`daemon_version`/`switch_current` (to fix at 145/002).
