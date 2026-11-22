# Task 001 — An upload over the bulk connection — Summary

- **Sprint:** sprints/sprint-121-desktop-transfer-engine
- **Completed:** 2026-11-22
- **Status:** done. `cargo xtask ci` was not run, as assigned; the narrow gates below are green.

## What was implemented
New module `upload` in `desktop/crates/transfer`. It runs one upload over an open `Connection`.

The flow:
1. `file_upload_request { path, transferId, ack: true }`. The `UploadWait` is registered first.
2. `Begin`, then `Chunk`s, then `End`. Each frame is awaited (`send_binary`) before the next bytes are read from the source.
3. The wait for `file_upload_complete`.

Chunks are `limits.chunk_bytes` clamped to 1..=32 KiB. A chunk is always filled before it is sent, even by a source that returns 1 byte per read. An exact multiple of 32 KiB sends no empty chunk.

Success needs `ok` and `bytesWritten == bytes sent`. A `complete` that names another stream is `Protocol`.

**Stopping an upload.** Between the daemon's answer and the last write of `End`, any stop sends `Error`:
- `client_aborted` on cancel.
- `client_error` on any other stop.

The send is best effort and bounded by `limits.close_wait`. A lost connection sends nothing. After `End` is written nothing is sent. A cancel before the answer to the request sends nothing either, because the stream is not known yet.

**Cancellation:** the caller passes a future (`cancel: impl Future<Output = ()> + Send`). The upload is cancelled when it completes, and it wins over pending work (`biased` select).
- The engine passes its token's `cancelled()`.
- `std::future::pending()` means it cannot be cancelled.
- A cancel works while a socket write is stuck.
- Dropping the upload future also stops it, but sends no `Error`.

**Progress:** `progress(total)` is called after each `Chunk` write completes. The total is cumulative. An empty file gets no call. A restart is a new call and starts from 0.

### Public API
```rust
// pistudiodesktop_transfer::upload   (module registered in lib.rs)
pub trait UploadSource: Send {
    fn size(&self) -> Option<u64>;
    fn read(&mut self, buf: &mut [u8]) -> impl Future<Output = io::Result<usize>> + Send; // 0 = end; buf never empty
}
pub struct Target<'a> { pub path: &'a str, pub transfer_id: &'a str }   // Copy
pub struct Uploaded { pub bytes: u64 }                                  // Copy
pub async fn upload<S, P, C>(
    connection: &Connection, target: Target<'_>, source: &mut S,
    progress: P, cancel: C, limits: &Limits,
) -> Result<Uploaded, UploadError>
where S: UploadSource, P: FnMut(u64) + Send, C: Future<Output = ()> + Send;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UploadError {
    Cancelled,
    DaemonRefused { reason: String },        // ok:false, rpc_error ("<message> (<code>)"), failed write in file_upload_complete
    SourceUnreadable { reason: String },     // io::Error Display; an over-full read is also this
    SourceChanged,                           // bytes read differ from size() at the start
    SizeMismatch { sent: u64, reported: u64 },
    Protocol(Error),
    ConnectionLost(Error),                   // Error::Closed(_) or Error::Timeout: for task-004 to act on
    Internal(&'static str),
}
impl UploadError { pub fn code(&self) -> &'static str }   // "cancelled","daemon_refused","source_unreadable","source_changed","size_mismatch","protocol","connection_lost","internal"
impl From<Error> for UploadError

// #[cfg(any(test, feature = "testing"))]
pub struct MemorySource;  // new(impl Into<Vec<u8>>), .claiming(Option<u64>); an UploadSource over memory
```

For task-004 and the engine:
- **Transfer id:** the caller supplies a new `transferId` per attempt. `Connection` already works that way, and no random-id dependency was added.
- **Restart:** an upload reads its source once from the start, so a restart needs a new source value.
- **`ConnectionLost(Timeout)`:** the connection may still be open. The daemon never answered the request, and the engine should drop the connection.

## Files created / changed
| File | Change |
|---|---|
| `src/upload.rs` | created: module docs, `UploadSource`, `Target`, `Uploaded`, `upload` and its helpers |
| `src/upload/error.rs` | created: `UploadError`, `code()`, `From<Error>`, 2 unit tests |
| `src/upload/memory.rs` | created: `MemorySource` (tests and `testing` feature), 2 unit tests |
| `src/upload/tests.rs`, `tests/{support,standin,outcomes,frames}.rs` | created: 36 integration tests |
| `src/lib.rs` | modified: `pub mod upload;` and its module-doc line |

Nothing was edited in `connection`, `wire`, `testing`, `error.rs` or `limits.rs`. The docs under `desktop/` were not edited: their `transfer` lines say "so far", which is incomplete now but not untrue.

## How it satisfies the scope
This follows spec § 4, S11, R3, R4 and D15, and `packages/client`'s `upload` (`client_aborted`, `client_error`).
- **Memory:** it holds one chunk buffer and one frame copy, whatever the file size. This is measured below.
- **Codes:** the six § Error handling codes for uploads map one to one onto `UploadError` variants. A lost connection has none of the page's codes and is its own variant.
- **No paths or secrets in messages:** the messages hold only the daemon's reasons and `io::Error`'s text.
- **Deviation:** an `rpc_error` answer to the request is reported as `DaemonRefused`, because the spec's list does not name that case.

## Build & test results
```
$ cargo test -p pistudiodesktop-transfer          (5 separate runs)
225 passed; 0 failed in each run (about 1.2 s each; no test sleeps seconds)

$ cargo clippy -p pistudiodesktop-transfer --all-targets --all-features -- -D warnings   -> clean (lib-only also clean)
$ cargo fmt -p pistudiodesktop-transfer -- --check                                       -> ok
$ cargo xtask layers   -> layering: ok (12 crates)
$ cargo xtask wasm     -> ok (transfer is empty on wasm32)
```
`cargo fmt -p pistudiodesktop-transfer` was run once before the check, so it may have reformatted the sibling's files in the same crate.

## Acceptance criteria
- [x] **Sizes against the stand-in.** An empty source, 1 byte, 32 KiB, 32 KiB + 1 and 64 MiB arrive whole.
  - `standin.rs`: `an_empty_source_arrives_whole`, `one_byte_…`, `exactly_one_chunk_…`, `one_chunk_and_one_byte_…`, `sixty_four_mebibytes_…`.
  - Each test compares the daemon's copy, the upload record and the progress calls.
  - `frames.rs` shows the exact frame sequence and sizes for 32 KiB + 1: Begin, 32768, 1, End.
- [x] **Bounded hold.**
  - `a_daemon_that_does_not_read_holds_the_upload_to_the_socket_buffers` (`standin.rs`):
    - The stand-in has `StopReading` after the Begin and the source is 256 MiB.
    - The test measured 2.7 MiB read ahead and asserts at most 16 MiB.
    - Read minus written is at most two chunks.
    - A cancel then returns with the socket stuck.
  - `a_slow_daemon_holds_…_and_it_goes_on_when_the_daemon_reads` (`frames.rs`):
    - A scripted daemon over a 64 KiB pipe reads only the Begin.
    - The upload holds at most the pipe plus 4 chunks, out of a 16 MiB file.
    - It then continues, and all 16 MiB arrive.
    - I used a pipe fake for the resume because `Fault::StopReading` cannot be undone.
- [x] **Each outcome, with the frame the daemon received** (`outcomes.rs`, read from `StandInDaemon::uploads()`):
  - `daemon_refused`:
    - Refused request: `no_free_stream`, `missing_fields`, `rpc_error`. The daemon sees no upload record.
    - Failed write: `UploadFails` returns `write_failed (ENOSPC)`. The daemon sees all bytes and the `End`, and keeps nothing.
  - `size_mismatch`: the daemon got all bytes and the `End`; its push reported another count.
  - `source_unreadable`: the daemon gets `client_error` after exactly one whole chunk. The connection is still usable for the next upload.
  - `source_changed`:
    - Grew: `client_error` after the first chunk.
    - Shrank: `client_error`, all 50,000 bytes arrived, `End` not sent, nothing kept.
    - Unknown size: not checked.
  - `cancelled`:
    - Mid-upload: `client_aborted`, and the bytes received equal the last progress value.
    - Before any send: nothing reaches the daemon.
    - While waiting for the completion: returns at once; `End` had gone, so no `Error` follows and the daemon keeps the file.
  - Lost connection:
    - A reset mid-upload.
    - A 1011 close while waiting for the completion: `ConnectionLost(Closed(Remote(Some(1011))))`.
    - No answer to the request after the answer time: `ConnectionLost(Timeout)`.
    - An already closed connection.
  - `protocol` (`frames.rs`): an answer without a stream, an answer of the wrong kind, a `complete` for another stream.
- [~] `cargo xtask ci` was not run, as assigned.

## Follow-ups / TODO(verify)
- **Stream slot on an early cancel:** a cancel while the request is still unanswered sends no `Error`, because the stream is unknown. A real daemon's slot would be freed only when the session ends. Task-004 or the engine can close the connection, or simply ignore it. A fix would mean waiting for the answer after the cancel.
- **Cancel racing `End`:** a cancel that arrives after `End` has been written may find the file already complete on the daemon. This is unavoidable.
- **Real files:** sprint 122's file source must report `size()` from metadata read at the start, or `None`. Its `io::Error` text must not carry a path.
- **Docs:** if the `transfer` lines in `desktop/AGENTS.md`, `desktop/README.md` and `desktop/docs/architecture.md` should list `upload`, whoever finishes the sprint's other task can add both modules at once.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
(no TypeScript changed in this wave)
```
