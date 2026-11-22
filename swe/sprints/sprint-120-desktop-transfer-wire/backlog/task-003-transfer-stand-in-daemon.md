# Task 003 — A stand-in daemon for the engine's tests

- **Sprint:** sprint-120-desktop-transfer-wire
- **Status:** backlog
- **Type:** test
- **Area:** desktop/crates/transfer/src/testing
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
The crate's tests have a daemon in their own process that answers the handshake, stores uploads, serves downloads, and misbehaves on request.

## Context / why
The engine must be tested through a drop and a cancel at every stage and against hostile frames, which a real daemon does not produce on demand. `net` tests the same way, against local servers.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 3, § 4, § 5, § 10, § Error handling & edge cases, § Acceptance criteria (Tests and machines)
- `packages/server/src/files/file-transfer.ts` (what the real daemon answers, in which order), `packages/server/src/ws/ws-server.ts` (401 and 403 at the upgrade, 1008 for a bad `hello`)
- `desktop/crates/net/src/testing.rs` and `dial/tests.rs` (local servers in tests)
- `desktop/apps/pistudiodesktop/scripts/platform-checks/stand-in-daemon.mjs` (the JavaScript stand-in of milestone 2: `hello` answered with the fixture's `status`)

## What to build
- A WebSocket server on `127.0.0.1` for tests: the upgrade (an optional required password: 401 without it), `hello` then `status` (feature flags configurable), `ping` then `pong`, uploads into memory with `file_upload_complete` (and R3's rule: nothing is kept unless `End` arrived), downloads by path from memory with `offset`, `ifUnchanged`, cancel, and the frame order of the real daemon.
- Faults a test can ask for: close or reset after N bytes or frames in either direction; stop reading; stop answering; answer `ok: false` with a chosen error; `no_free_stream`; change a file between two requests; report a wrong `bytesWritten`; send a frame out of order, an oversized message, an `Error` as first frame, more bytes than `length`.
- It is available to the crate's own tests and, behind a feature, to the app binary's tests (sprint 122).
- Its own tests pin it to the fixtures' shapes, so it cannot drift from the contract unnoticed.

## Out of scope
- The engine (sprint 121).
- Being a faithful daemon beyond what the engine uses.

## Acceptance criteria
- [ ] A client written in the test with the wire of task-002 completes a handshake, an upload and a ranged download against it, and each named fault is observable from that client.
- [ ] The stand-in is not compiled into a release build of the app (a feature or `cfg(test)`).
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- The real daemon is checked later: sprint-122/task-007 and sprint-123/task-001 run the engine against a production daemon.
