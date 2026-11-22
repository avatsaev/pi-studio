# Task 001 — Crates `relay` and `ssh` with their dependencies, the layer table and the licences — Summary

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- New crates `pistudiodesktop-relay` and `pistudiodesktop-ssh` (layer 8, native only), each with a test that uses its dependencies.
- Workspace dependencies: `crypto_box` 0.9 (feature `salsa20`; the feature is not called `salsa`), `sha2` 0.10, `form_urlencoded` 1, `russh` 0.65 with `default-features = false, features = ["ring", "rsa", "flate2"]`, `ssh2-config` 0.9.
- `xtask`: both crates in the layer table with a test that only apps may use them; `forbidden_in_lock` (with a test) makes `cargo xtask layers` fail when `Cargo.lock` holds `aws-lc-rs` or `aws-lc-sys`.
- `ATTRIBUTION.md`: 85 new lock packages grouped in rows; every licence read from `cargo metadata`: all Apache-2.0, MIT, BSD-3-Clause or an OR of those (`fiat-crypto` offers BSD-1-Clause too).

## Files changed
`desktop/Cargo.toml`, `Cargo.lock`, `crates/relay/**`, `crates/ssh/**`, `xtask/src/layers.rs`, `xtask/src/main.rs`, `ATTRIBUTION.md`

## Build & test results
```
cargo test -p pistudiodesktop-relay -p pistudiodesktop-ssh -> 2 passed
grep 'name = "aws-lc' Cargo.lock -> 0
cargo xtask ci -> all 8 steps passed (one earlier run failed at `test` under load, a rerun of the same tree passed 1029/1029 twice: a flake, not traced)
```

## Acceptance criteria
- [x] `cargo xtask ci` passes on Linux.
- [x] No `aws-lc` package in `Cargo.lock`.
- [x] Every new package is covered in `ATTRIBUTION.md` with a licence the rule accepts.

## Follow-ups
- The macOS and Windows builds are t002.
- A test failed once in `cargo xtask ci` under load; the name was not captured.
