# Task 001 — Crates `relay` and `ssh` with their dependencies, the layer table and the licences

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Status:** backlog
- **Type:** chore
- **Area:** desktop/Cargo.toml, desktop/crates/relay, desktop/crates/ssh, desktop/xtask/src/layers.rs, desktop/ATTRIBUTION.md
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** —

## Goal
Two new workspace crates exist and build, with every third-party dependency milestone 4 needs, and no `aws-lc` crate in the lock.

## Context / why
S1 puts the relay client and the SSH client in crates of their own at layer 8, beside `transfer`, depending on `net` only. The spec's first TODO(verify) is whether `russh` builds with `ring` (the workspace avoids `aws-lc`, which needs cmake or NASM on Windows) and whether its dependencies, including the pinned pre-release `ssh-key`, pass the permissive-licence rule (`desktop/AGENTS.md` rule 9).

## Scope references
- `swe/features/desktop-relay-ssh.md` § Decisions S1, § 7, § 12, § TODO(verify) (first item)
- `desktop/Cargo.toml` ([workspace.dependencies], the comment on `ring`)
- `desktop/xtask/src/layers.rs` (`TABLE`, the tests `net_is_usable_by_transfer_and_apps_only`, `transfer_is_usable_by_apps_only`)
- `desktop/ATTRIBUTION.md`
- `desktop/crates/transfer/Cargo.toml` (the `testing` feature pattern)

## What to build
- `desktop/crates/relay` (`pistudiodesktop-relay`) and `desktop/crates/ssh` (`pistudiodesktop-ssh`): `lib.rs` with the crate doc only, `cfg(not(wasm32))` as `net`.
- Workspace dependencies: `crypto_box` (SalsaBox), `form_urlencoded` (for `model`, sprint 124/t003), `russh` with `default-features = false, features = ["ring", "rsa", "flate2"]`, `ssh2-config`. Each crate declares only what it uses; a dependency nobody uses yet is added by the task that uses it, so this task adds the ones each crate's doc-only lib needs to compile against (a `use` in a test is enough).
- `TABLE`: both at `Class::Layer(8)`, with tests that only apps may depend on them.
- A test in `xtask` (or the layers check) that fails when `Cargo.lock` contains a package named `aws-lc-rs` or `aws-lc-sys`.
- `ATTRIBUTION.md`: every new crate in the lock with its licence; any licence outside the rule stops the task and is reported.

## Out of scope
- Any code of the relay or SSH clients.

## Acceptance criteria
- [ ] `cargo xtask ci` passes on Linux.
- [ ] `Cargo.lock` has no `aws-lc` package.
- [ ] Every new package in the lock is in `ATTRIBUTION.md` with a licence the rule accepts.

## Test / verification plan
- `cd desktop && cargo xtask ci`
- `grep -c aws-lc desktop/Cargo.lock` gives 0

## Notes
- The macOS and Windows half of the build question is t002.
