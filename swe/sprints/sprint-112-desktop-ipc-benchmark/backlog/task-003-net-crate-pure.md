# Task 003 — `net` crate, pure parts: frame batch codec, inbound window, outbound order buffer

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/net
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
A new crate holds the three pieces of bridge logic that need no socket, tested against hostile input.

## Context / why
The benchmark's candidates (task-004) and the real bridge (sprint 115) share this code, so the gate measures what will ship. Everything here takes bytes that crossed the webview boundary: bounds are checked and nothing panics.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 3 (frames, inbound window, outbound order), § 8
- `desktop/xtask/src/layers.rs` (`TABLE`, `cmd_wasm` in `main.rs`: layered and standalone crates are checked for wasm32)
- `desktop/crates/store/Cargo.toml`, `src/lib.rs` (how a native-only crate is empty on wasm32)
- `desktop/docs/architecture.md` § Layers

## What to build
- Crate `pistudiodesktop-net`, with no workspace dependency, registered in the layer table at a class that makes `cargo xtask layers` refuse a dependency on it from `engine` or `shell`. Empty on wasm32, like `store`.
- **Codec.** A batch is a sequence of items `[kind: 1 byte][length: 4 bytes, little-endian][payload]`, kind 1 for text (UTF-8) and 2 for binary. Encode appends an item to a buffer; decode walks a byte slice and yields items or an error (unknown kind, a length past the end, text that is not UTF-8, an item above the message cap of 128 MiB).
- **Inbound window.** Counts payload bytes sent to the page and bytes acknowledged. Reading stops above 8 MiB unacknowledged and resumes below 4 MiB. An acknowledgement larger than what is outstanding is an error, not a wrap-around.
- **Outbound order buffer.** Sequence numbers start at 0. A frame with the expected number passes at once, with any waiting frames that follow it; an early one waits, at most 64 of them; a number already passed, or a 65th early frame, is an error; a gap older than 5 s (the clock is injected) is the error `send_order`.
- The limits are named constants in one place.

## Out of scope
- Sockets, TLS and tasks (sprint 115).
- The TypeScript twin of the codec (sprint 115, task-004).

## Acceptance criteria
- [ ] Decoding what was encoded gives the same items, for generated batches of mixed kinds and sizes including empty payloads.
- [ ] Truncated input, a wrong kind, a length that overflows, and random bytes all return an error and never panic (a generated-input test).
- [ ] The window stops at the high mark, resumes at the low mark, and refuses an acknowledgement that exceeds what is outstanding.
- [ ] The order buffer passes frames in order when they arrive shuffled within 64, refuses a duplicate and a 65th early frame, and reports `send_order` once the injected clock passes 5 s on a gap.
- [ ] A layer-check test shows that `engine` or `shell` depending on `net` is a violation.
- [ ] `cargo xtask ci` passes, including the wasm step.

## Test / verification plan
- `cargo test -p pistudiodesktop-net`
- `cargo xtask ci` in `desktop/`

## Notes
- `desktop/docs/architecture.md` says no socket exists below the app binary; that sentence changes in sprint 115, when the crate gets one. Here, add the crate to the layer table of the document only.
- If the benchmark picks one message per frame, the codec is still used for nothing but tests: task-007 decides whether it stays.
