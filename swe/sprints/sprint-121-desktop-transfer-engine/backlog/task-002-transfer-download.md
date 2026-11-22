# Task 002 — A save over the bulk connection (§ 5, S12)

- **Sprint:** sprint-121-desktop-transfer-engine
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/transfer/src
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-120/task-004

## Goal
Given a connection and a sink, the crate downloads a daemon file into it from any offset and reports the outcome precisely.

## Context / why
The page's save crosses the socket and then IPC. Here Rust writes what arrives; it must not read faster than it writes.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 5, § Error handling & edge cases, decisions S12, S3 (the 1 MiB hold), D13
- `docs/desktop-client-handoff.md` § 2 ("What a Rust engine implements for downloads": the cancel race, the stream id's reservation)
- `packages/client/src/file-transfer-client.ts` (`downloadTo`)

## What to build
- A sink trait: write, the bytes written so far, finish, discard (the app implements it over a save; tests over memory).
- The flow: `file_download_request { path, stream }` with a stream id from the connection's own pool of 0–255; with `offset` and `ifUnchanged { size, mtimeMs }` when the caller resumes; no `length`. Then `Begin`, `Chunk`s, `End` or `Error`.
- At most 1 MiB that is not yet written is held: beyond it the connection is not read until the sink has caught up.
- Done when `End` came and exactly `length` bytes were written; then the sink is finished. More bytes than `length`, a `Chunk` before `Begin`, or `End` early is `protocol`.
- Outcomes: `changed` (the answer or an `Error` frame says so); `daemon_refused` with the reason (`not_found`, `not_a_file`, `unreadable`, `no_free_stream`, `read_failed`, …); `disk` with the system's reason; `cancelled`. A cancel sends `file_download_cancel_request` and keeps the stream id reserved until the daemon's last frame, a refusal, or the connection's end; an `Error` may be the first and only frame.
- The answer's `totalBytes` and `mtimeMs` are returned to the caller for a later resume; progress is the bytes written.

## Out of scope
- Resuming after a drop (task-004).
- Writing a real file (sprint 122).

## Acceptance criteria
- [ ] Against the stand-in: an empty file, 1 byte, 64 MiB; and a download from an offset whose result, appended to the first part, equals the file.
- [ ] With a slow sink, the bytes held never exceed 1 MiB plus one frame.
- [ ] A cancel sent right after the request (before the answer) ends cleanly in both orders the daemon may answer, and the stream id is free afterwards.
- [ ] Each outcome above is produced by a test; `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: no unwrap, expect or panic outside tests, no unsafe; every size is checked before it is used.
- This task and task-001 both add a module line to `lib.rs`: the second to land re-reads it.
