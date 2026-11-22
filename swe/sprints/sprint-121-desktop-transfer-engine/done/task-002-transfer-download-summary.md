# Task 002 — A save over the bulk connection — Summary

- **Sprint:** sprints/sprint-121-desktop-transfer-engine
- **Completed:** 2026-11-22
- **Status:** done. `cargo xtask ci` was not run, as assigned. The narrow gates below are green.

## What was implemented
New module `download` in `desktop/crates/transfer`. `save` runs the wire flow of spec § 5 on an open `Connection`, writing into a `Sink`.

- **Request.**
  - It takes a stream id from `connection.download()` before it sends `file_download_request { path, stream }`.
  - `offset` (the sink's `written()`) and `ifUnchanged { size, mtimeMs }` are sent only on a resume. `length` is never sent.
- **Checks on the answer.** Any failure is `protocol`:
  - the answer names the asked stream and offset;
  - its range ends exactly at the end of the file (`offset + length == totalBytes`, checked add);
  - a resume got the file it guarded;
  - `Begin` repeats the answer.
- **Backpressure.** Each `Chunk` is written to the sink while its delivery is still held, and released only afterwards. At most the 1 MiB hold plus one frame is waiting for the sink, so memory does not grow with the file.
- **Done.** `End` came, exactly the announced bytes were written, and `sink.written() == totalBytes`. Then `finish`. The count is checked before `finish`, because a finished sink has put the file in place.
- **Protocol errors.** More bytes than announced, a `Chunk` before `Begin`, an early `End`, an `End` before `Begin`, and a second `Begin` are all `protocol`.
- **`Error` frame.** It may be a stream's first and only frame. `changed` maps to `Changed`; anything else to `DaemonRefused { reason }`.
- **Stopping.** After a cancel, a failed write, or a daemon protocol error, `save` sends `file_download_cancel_request`. It keeps the stream id reserved until one of these happens:
  - a terminal frame (`End` or `Error`) arrives;
  - the request is refused;
  - the daemon says `not_found` while it has not accepted this request (see below);
  - the connection ends.
- **How the cancel race resolves.**
  - The cancel may be answered before or after the request. After either, `save` returns `Cancelled`.
  - A `not_found` after an accepted answer does not free the stream. The terminal frame is still awaited, because an accepted download always ends with one.
  - Frames keep being taken and dropped while it waits, because the cancel's answer sits behind them on the socket.
  - After `limits.answer_wait` with nothing settled, `save` returns anyway. A spawned task then holds the reservation, still taking and dropping frames, until the terminal frame or the connection's end.
- **Outcomes.** Every `SaveError` except `ConnectionLost` discards the sink. `ConnectionLost` is its own outcome: the sink is left open (neither finished nor discarded). It carries `version: Option<Version>`, the answer's `totalBytes` and `mtimeMs`, for the resume's `ifUnchanged`. A request that got no answer in 30 s is also `ConnectionLost(Timeout)`, with a cancel sent as above.
- **Cancel from outside.** `cancel` is a future, the same convention as the sibling's `upload`; the engine passes `token.cancelled()`.
  - A cancel that is already complete sends nothing.
  - During a write it drops the write; the sink is then only discarded.
  - During `finish` it is ignored: the save is complete.
- **Progress.** `FnMut(Progress)` is called once when the daemon accepts (`done` is the sink's bytes, `total` the file's size), then after each write.

### Public API (`pistudiodesktop_transfer::download`)
```rust
pub trait Sink: Send {
    fn written(&self) -> u64;
    fn write(&mut self, data: &[u8]) -> impl Future<Output = io::Result<()>> + Send;   // data is never empty
    fn finish(&mut self) -> impl Future<Output = io::Result<()>> + Send;
    fn discard(&mut self) -> impl Future<Output = ()> + Send;
}
pub struct Version { pub total_bytes: u64, pub mtime_ms: u64 }                  // Copy
pub struct Request<'a> { pub path: &'a str, pub resume: Option<Version> }       // None: the sink must be empty (else Internal)
pub struct Saved { pub version: Version, pub bytes: u64 }                       // bytes written by this call
pub struct Progress { pub done: u64, pub total: u64 }
pub enum SaveError {                                                            // Debug, Clone, PartialEq, Eq, thiserror::Error
    Cancelled, Changed, DaemonRefused { reason: String }, Disk { reason: String },
    Protocol(Error), ConnectionLost { reason: Error, version: Option<Version> }, Internal(&'static str),
}
impl SaveError { pub fn code(&self) -> &'static str }   // cancelled | changed | daemon_refused | disk | protocol | connection_lost | internal

pub async fn save<S, P, C>(connection: &Connection, request: Request<'_>, sink: &mut S, progress: P, cancel: C, limits: &Limits) -> Result<Saved, SaveError>
where S: Sink, P: FnMut(Progress) + Send, C: Future<Output = ()> + Send;
pub struct MemorySink;   // under cfg(any(test, feature = "testing")): new(), with_bytes(Vec<u8>), bytes(), is_finished(), is_discarded()
```

Notes for task-004 (resume) and the engine:
- A resume is `save` with `resume: Some(version)` and the same sink.
- `ConnectionLost(Timeout)` leaves the connection open. The engine should close and reopen it before the resume.
- The cancel future must not be polled again after it completes; `save` does not.
- A dropped `save` future sends no cancel and frees the stream id at once. Use `cancel` instead.

## Files created / changed
| File | Change |
|---|---|
| `src/download.rs` | created: module docs, `Version`, `Request`, `Saved`, `Progress`, `save` |
| `src/download/sink.rs`, `error.rs` | created: `Sink`; `SaveError` and its `code()` |
| `src/download/answer.rs`, `receive.rs`, `settle.rs` | created: answer and `Begin` checks; the frame loop; the cancel and stream reservation |
| `src/download/memory.rs` | created: `MemorySink` |
| `src/download/tests.rs`, `tests/{support,standin,cancel,hostile,backpressure}.rs` | created: 47 tests |
| `src/lib.rs` | added `pub mod download;` and its module-doc line |
| `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md` | `transfer` entry/row now describes the save |

Nothing was changed in `connection`, `wire`, `testing` or `error.rs`.

## How it satisfies the scope
It follows spec § 5, decisions S12, S3 (the 1 MiB hold) and D13, the handoff § 2 notes on the cancel race, and the SDK's `downloadTo`. The only departures from the SDK are intended:
- An `End` with `ok: false` is `DaemonRefused("the transfer was aborted")`.
- A daemon `Error` frame `cancelled` that the user did not ask for is `DaemonRefused("cancelled")`.

## Build & test results
```
$ cargo test -p pistudiodesktop-transfer        # run 5 times
272 passed; 0 failed each time (47 of them are `download::`)
$ cargo test -p pistudiodesktop-transfer --features testing download::   -> 47 passed
$ stress: `download::` ×25 with --test-threads=24, and the whole binary 6 runners × 4 in parallel -> no failure
$ cargo clippy -p pistudiodesktop-transfer --all-targets --all-features -- -D warnings   -> clean (also clean without --all-features, and with --features testing)
$ cargo fmt -p pistudiodesktop-transfer -- --check   -> ok
$ cargo xtask layers   -> layering: ok (12 crates)
$ cargo xtask wasm     -> ok
```
Mutation checks: I temporarily broke nine behaviours. Each broken version failed at least one test; the files were restored and the suite re-run green. The nine were:
- freeing the stream on `not_found` after an accepted answer;
- dropping the range-end check;
- dropping the early-`End` check;
- freeing the stream on settle timeout instead of holding it;
- ignoring a `not_found` cancel answer;
- sending `offset` on a first request;
- dropping the background reservation task.

## Acceptance criteria
- [x] Against the stand-in: an empty file, 1 byte, 64 MiB, and a download from an offset appended to the first part equals the file.
  - Tests: `standin.rs`: `an_empty_file…`, `one_byte_arrives…`, `a_file_of_64_mib_arrives_whole`, `a_save_from_an_offset_appended_to_the_first_part_is_the_file`.
  - Also tested: files around the chunk size, and a drop mid-save by close and by reset followed by a resume into the same sink on a second connection.
- [x] With a slow sink, the bytes held never exceed 1 MiB plus one frame.
  - `backpressure.rs`: a stuck sink on a scripted daemon over a 64 KiB pipe. The daemon had pushed at most the hold plus the pipe, the client's read buffer and one frame of a 12.5 MiB file (≈39 frames at the 1 MiB hold, ≈17 at 64 KiB); after release every byte arrives in order.
  - The stand-in version, `a_slow_sink_gets_every_byte_in_order…`, checks correctness only (see Follow-ups).
- [x] A cancel right after the request, before the answer, ends cleanly in both orders, and the stream id is free afterwards.
  - `cancel.rs`, on a scripted daemon: cancel answered before the request, then accepted with only an `Error cancelled` and no `Begin`; the same with the request refused and no frame; request answered before the cancel; refused with the cancel finding nothing; a download that already finished.
  - Stand-in analogues: `ErrorFirst`, `Refuse` and `Silence{Download}`.
  - "Free afterwards" is checked by taking all 256 streams.
- [x] Each outcome is produced by a test:
  - `changed`: stale guard, `Error changed`, refusal `changed`;
  - `daemon_refused`: `not_found`, `not_a_file`, `unreadable`, `no_free_stream`, `read_failed`, an `rpc_error`;
  - `disk`: failed write, failed `finish`;
  - `cancelled`: mid-download, mid-write, already complete, and a stalled daemon;
  - `protocol`: out-of-order frames, extra bytes, an oversized message, hostile answers, 5 GiB and 2^53−1 announcements, and a 300-round seeded loop that never panics;
  - the dropped connection, which leaves the sink open.
- [~] `cargo xtask ci` was not run, as assigned.

## Follow-ups / TODO(verify)
- Unification with the sibling's upload. Both take `cancel` as a future and `limits: &Limits`. Progress differs: `FnMut(u64)` for upload, `FnMut(Progress)` for save, because the save's total is known only from the daemon's answer. `SaveError::ConnectionLost` also carries `version`; the sibling's `UploadError::ConnectionLost` does not. The engine task can unify these.
- A late refusal of a request that timed out cannot be seen: `Connection::request` forgets the id. The stream then stays reserved until the terminal frame or the connection's end (it is held by the background task).
- `Sink` uses return-position `impl Future`, so it is not dyn-compatible. The engine will be generic over the sink or use an enum.
- The stand-in's slow-sink test cannot measure the connection's hold from outside. The bound is measured on the scripted pipe, so it includes the pipe and the client's read buffer. Task-007 and sprint-123/task-001 check the real daemon.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
(no TypeScript changed in this wave)
```
