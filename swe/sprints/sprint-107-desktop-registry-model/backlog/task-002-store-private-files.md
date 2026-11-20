# Task 002 — `store` crate: files readable by the user only

- **Sprint:** sprint-107-desktop-registry-model
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/store
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** sprint-102/task-004

## Goal
An atomic write can ask for a private file, and on macOS and Linux that file has mode 0600 from the moment it exists, also after it replaces an older, looser file.

## Context / why
D13, D27. The registry file holds passwords and pairing links in clear text until milestone 2 moves them to the OS keychain. The atomic write of sprint-102/task-002 creates a temporary file and renames it; the mode has to be right on the temporary file, or the secret is briefly readable by others.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 1 ("Mode 0600 on macOS and Linux; default profile permissions on Windows")
- `swe/features/desktop-native-host.md` § TODO(verify) (file modes)
- `desktop/crates/store/` (sprint-102/task-002: the atomic write, the read with set-aside)

## What to build
- A "private" variant (or option) of the atomic write: on Unix the temporary file is created with mode 0600, so no window exists in which it is looser; on Windows it behaves as the normal write.
- A file set aside by the read (`<name>.corrupt-<timestamp>`) keeps the mode it had: a renamed private file stays private.
- Missing parent directories are still created; their mode is the platform default.

## Out of scope
- Encrypting anything. The OS keychain (milestone 2).
- Which files are private (the engine decides: task-003).

## Acceptance criteria
- [ ] On Unix a private write of a new file gives mode 0600.
- [ ] A private write over an existing 0644 file leaves 0600.
- [ ] A private file that is set aside as corrupt is still 0600.
- [ ] The normal write is unchanged; existing tests pass.
- [ ] `cargo xtask wasm` passes (the crate stays empty on wasm32).

## Test / verification plan
- `cargo test -p pistudiodesktop-store` (mode assertions are Unix-only tests)
- `cargo clippy -p pistudiodesktop-store --all-targets -- -D warnings`
- `cargo xtask wasm`

## Notes
- Runs in parallel with task-001: another crate, no shared file.
- Windows relies on the user profile's default permissions, as the spec says. Nothing here has run on Windows.
