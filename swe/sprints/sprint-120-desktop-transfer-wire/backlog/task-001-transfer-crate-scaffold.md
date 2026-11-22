# Task 001 — New crate `pistudiodesktop-transfer` at layer 8; `net::dial` takes a message limit (S2, S3)

- **Sprint:** sprint-120-desktop-transfer-wire
- **Status:** backlog
- **Type:** chore
- **Area:** desktop/crates/transfer, desktop/crates/net, desktop/xtask
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The crate exists, is registered above `net` in the layer check, and can dial with its own message limit.

## Context / why
The engine speaks the daemon's protocol and schedules transfers; it must be testable without Tauri. `net` is the only crate that opens a socket and until now only an app binary could use it.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 9 (the table), § 3 (Dial), decisions S2, S3
- `desktop/xtask/src/layers.rs` (`TABLE`, `UI_LAYER`, the tests), `desktop/Cargo.toml` (members, workspace dependencies)
- `desktop/crates/net/src/dial.rs` (`dial`, `open`, the `WebSocketConfig`), `limits.rs` (`MAX_MESSAGE_BYTES`); callers: `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs`, `desktop/apps/ipc-bench`
- `desktop/AGENTS.md` (the workspace map, golden rule 4), `desktop/docs/architecture.md` (§ Layers, "only an app binary may use `net`")

## What to build
- `desktop/crates/transfer`: `Cargo.toml` (native-only dependencies, like `net`), `lib.rs` with `#![cfg(not(target_arch = "wasm32"))]`, one error enum with `thiserror`, and `limits.rs` holding the values of S3 as named constants (idle 30 s, ping after 10 s, dropped after 30 s, backoff 1 s to 30 s, answer 30 s, message 16 MiB, download hold 1 MiB, 3 transfers, 32 KiB chunk) with a `Limits` struct a test can shorten, as `net` has.
- `layers.rs`: the crate at layer 8; it may depend on `net`; no UI crate; a test that `shell` or `engine` depending on `transfer` is flagged, and `transfer` on `tauri` is flagged.
- `net::dial`: the message limit becomes a parameter (the signature is the implementer's: an argument or an options struct). The proxy's callers pass `MAX_MESSAGE_BYTES`; behaviour there is unchanged.
- The rule text in `desktop/AGENTS.md` and `desktop/docs/architecture.md`: "only `transfer` and an app binary may use `net`"; the workspace map gains the crate's line.

## Out of scope
- Any protocol code (task-002).
- A new third-party dependency beyond what the workspace already declares, unless its licence is checked and recorded.

## Acceptance criteria
- [ ] `cargo xtask layers` passes with the crate registered, and its new tests show the two violations above.
- [ ] `cargo xtask wasm` passes: the crate is empty on wasm32.
- [ ] The proxy's tests pass unchanged; a socket dialled with a 16 MiB limit refuses a larger message (a test in `net`).
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-net -p pistudiodesktop-transfer -p xtask`
- `cargo xtask ci` in `desktop/`

## Notes
- `desktop/Cargo.toml` and `xtask/src/layers.rs` are edited by this task only in this sprint.
