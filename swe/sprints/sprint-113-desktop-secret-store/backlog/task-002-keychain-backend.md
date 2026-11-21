# Task 002 — Keychain backend: macOS Keychain, Windows Credential Manager, the Secret Service on Linux

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/secrets
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The secret store can keep its items in the operating system's keychain, and can tell quickly when there is none.

## Context / why
P3. This is the default backend. A Linux desktop without a Secret Service, a container and a locked keychain must not hang the launch: the app then uses the file backend (P4).

## Scope references
- `swe/features/desktop-transport-bridge.md` § 5 (the `keychain` row, the account name, blocking), § TODO(verify) ("The keychain crate", "macOS and an unsigned build")
- `desktop/crates/secrets/` (task-001)
- `desktop/AGENTS.md` rule 9 (licences), `desktop/ATTRIBUTION.md`
- `desktop/docs/development.md` (the container)

## What to build
- Choose the crate: `keyring` 4.2.0 is the candidate (MIT OR Apache-2.0, Rust 1.88; checked on crates.io, 2026-11-21). Read which backend crates it pulls in on each platform and their licences before adding it; record the choice and the licences in the summary.
- Item naming: service `com.avatsaev.pi-studio`; account `<scope>/<entry id>/<kind>`, where `<scope>` is `default`, or 16 hexadecimal digits of a hash of the configuration directory's path when the app was started with `--config-dir`.
- A probe that answers within 2 s whether the keychain can be used at all (a read of a key that does not exist), mapping the platform's errors to `unavailable`, `denied` and `failed`.
- The dependencies are per target, so a Linux build pulls no macOS or Windows code and wasm32 stays empty.
- A fake keychain for unit tests, including one that blocks, for task-004.

## Out of scope
- Choosing the backend at launch and the `--secret-store` option (task-006).
- macOS and Windows runs (sprint 117).

## Acceptance criteria
- [ ] In the container with a Secret Service running (`dbus-run-session` and a keyring daemon), set, get and delete round-trip, and `secret-tool` sees the item under the service and account names above.
- [ ] In the container without one, the probe answers `unavailable` within 2 s and nothing hangs.
- [ ] Two configuration directories give two scopes: an item written for one is not read for the other.
- [ ] No log line and no error contains a secret (marker test).
- [ ] The licences of every crate added are permissive and listed in the summary; `ATTRIBUTION.md` is updated if the rules ask for it.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-secrets`
- The two container runs, with their commands in the summary.
- `cargo xtask ci` in `desktop/`

## Notes
- If the image lacks a keyring daemon, build a derived image for the check and say how; do not add it to the default image without need.
- Expected and accepted by the owner for now: on macOS an unsigned build is asked for keychain access again after each update. Nothing to do here; sprint 117 records what happens.
- A keychain call can block on a prompt. This crate does not hide that: its callers keep it off the owner thread (task-004).
