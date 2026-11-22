# Task 001 — An upload over the bulk connection (§ 4, S11)

- **Sprint:** sprint-121-desktop-transfer-engine
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/transfer/src
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-120/task-004

## Goal
Given a connection and a source of bytes, the crate uploads it to a daemon path and reports the outcome precisely.

## Context / why
The page's upload reads the file in the page. Here Rust reads it and sends it; memory must not grow with the file.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 4, § Error handling & edge cases (the codes), decisions S11, R3, R4, D15
- `packages/client/src/file-transfer-client.ts` (`upload`: the flow to match, `client_aborted`, `client_error`)

## What to build
- A source trait: the size if known, and "read the next bytes" (the app implements it over a local file; tests over memory).
- The flow: `file_upload_request { path, transferId, ack: true }` with a new `transferId`; `Begin`; `Chunk`s of at most 32 KiB, each write to the socket awaited before more is read; `End`; then wait for `file_upload_complete` with that `transferId`.
- Done only when `ok: true` and `bytesWritten` equals the bytes sent; otherwise `size_mismatch`.
- Outcomes: `daemon_refused` with the daemon's reason (a refused request, a failed write in `file_upload_complete`); `source_unreadable` with the system's reason; `source_changed` when the bytes read differ from the size at the start; `cancelled`. After `Begin`, a cancel sends `Error` `client_aborted` and any other stop sends `Error` `client_error`.
- Progress: the bytes whose write has completed, reported to a callback.

## Out of scope
- Starting again after a drop (task-004).
- Reading a real file (sprint 122).

## Acceptance criteria
- [ ] Against the stand-in: an empty source, one of 1 byte, one of 32 KiB + 1 and one of 64 MiB arrive whole.
- [ ] With a stand-in that does not read, the upload holds a bounded amount (measured in the test) and continues when reading resumes.
- [ ] Each outcome above is produced by a test, with the frame the daemon received for it.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: no unwrap, expect or panic outside tests, no unsafe; every size is checked before it is used.
- A dropped connection during an upload is an outcome of its own for task-004 to act on, not a failure of the transfer.
