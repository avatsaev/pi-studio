# Task 002 — The remote supervisor installs the binary — Summary

- **Sprint:** sprint-144-desktop-ssh-install
- **Completed:** 2026-11-24
- **Status:** done

## What was built
- `RemoteState`/`RemoteFailReason` per R7: `CliOutdated`, `Updating`, `UpdateFailed` gone; `Outdated`, `Unsupported{system}`, `Installing{stage, done?, total?}` new; serde pinned in tests.
- Engine: `daemon.remote.install` (enabled for `not_installed`, `stopped`, an install failure); Update for `outdated`/`stopped`; Start refused with `not_installed`, `outdated`, `unsupported`.
- `shell/remote_supervisor.rs` + `remote_supervisor/scripts.rs`: one facts script (system, arch, musl, host folder, binary version or none; the unsupported system name from the host's own words), archive from the shared cache (checksum vs the pin), `mkdir -p bin/tmp`, send, check (size, SHA-256 when a tool exists), unpack, start, prune; each step has its own failure reason; a binary at or above the pin is never replaced and a running daemon is used as is (P11); update = install then `daemon restart`; only the last lines of host output reach `install_failed`/`send_failed`; the shell crate depends on neither `ssh` nor `install`.
- `Session::daemon_health(port)` in the ssh crate (`GET /api/health` over a direct-tcpip channel); app: `ssh_session.rs` send/daemon-version hooks, `LocalInstaller` as `ArchiveSource` sharing the local archive cache, `daemons.rs` triggers the "started" hook on Install/Update; new end-to-end install test through the in-process SSH server (archive byte for byte, step order, one connection, nothing leaks); allowlists (`shell/src/daemons.rs`, `apps/pistudiodesktop-cli/tests/cli.rs`) include `daemon.remote.install`.
- Docs: `desktop/AGENTS.md`, `docs/{architecture,control-protocol,development}.md`, root `AGENTS.md` (SSH update mention).

## Results
Narrow: shell 352, app 256 + e2e, engine/model/ssh/install pass; clippy `-D warnings`, layers, wasm, panic_hunt ok. Sprint gate: see sprint report.

## Acceptance
- [x] Fake-host supervisor tests: each target mapping and unsupported case, happy path with stage order, each failure state, a present version only switches the link, a newer binary started not replaced, a running daemon is running with no install offered. [x] `cargo xtask ci`.

## Deviations / follow-ups
The daemon version comes from `GET /api/health` over SSH (Rust cannot see the handshake); `outdated` is learned only by a probe (`open_daemon` marks `running` on the first successful open); not run against a real SSH host (145/001); `daemon restart` on a stopped daemon assumed from the CLI source; `-p pistudiodesktop-install` not clippy-checked by this task (the wave `cargo xtask ci` clippy covers it).
