# Task 004 — Recovery: reconnect, wake, final vs retried errors, resume and restart — Summary

**Status:** done. `cargo xtask ci` passes (all 8 steps). The crate's own gates are also green: `cargo test -p pistudiodesktop-transfer` ×5 (345 passed each), clippy with `--all-targets --all-features -D warnings` (also without `--all-features`), `cargo fmt --check`, `cargo xtask layers` and `cargo xtask wasm`. The 14 recovery tests were also run 6 in parallel ×3 and none failed.

## What was implemented
All in `desktop/crates/transfer`.

**Reconnect**
- **On a drop:** an attempt that ends in `Ended::Lost` sends its transfer back to `active`/`Waiting` with its work, and the engine emits one `waiting` event. A cancel that raced the drop settles the transfer instead.
- **Dialling:** the lost connection is closed and the engine dials again at once. A retryable failure leaves the connection in a new `Conn::Waiting` state.
- **Delay:** 1 s doubling to 30 s with no attempt limit, reset to 1 s on a successful open and when the engine stops trying. The deadline is fixed when the wait starts.
- **Stopping:** `wake()` ends a wait at once; the delays keep growing if that dial fails again. When nothing is active or queued, the engine stops dialling and waiting.

**What is final**
- **Final codes:** `FINAL_CODES` is public (`unauthorized`, `host_not_allowed`, `tls`, `invalid_address`, `secret_missing`, `secret_unavailable`, `not_bridged`, `no_current`, `unsupported`, `unsupported_daemon`, `protocol`).
- **Connector errors:** a connector error is final if `retry == false` or its code is in `FINAL_CODES`.
- **Errors from `hello`:** these are final by code, so `unsupported_daemon` and `protocol` are final and `handshake` is retried.
- **`internal`:** I also made `internal` from the `hello` exchange final, because no wait fixes an app fault. This goes beyond the task's list.
- **Effect:** a final error fails every active and queued transfer. A transfer still running on a connection that has already ended is left alone and settles or waits when its attempt returns.

**Resume and restart**
- **Save:** `SaveWork` keeps the `Version` from its first answer. It resumes with `offset` = the sink's written bytes and `ifUnchanged`; `changed` fails it and the sink is discarded. The call now resolves with the file's `total_bytes`, not the bytes written in the last attempt.
- **Upload:** `UploadSource` gains `rewind()`, which the engine calls before every attempt but the first. This is the reopenable-source design. It also resets the progress to 0 without an event. A new `transferId` is made per attempt.
- **Restart count:** `restarts` increases when a transfer runs again after a loss, not while it waits.
- **Waiting events:** a drop emits `waiting` for the transfer. The existing `Waiting` events before the first open are unchanged. `last_error` also records the connection's loss or failed open that made transfers wait.

**Early-cancel stream slot (cheap fix):** `upload()` now waits for the daemon's answer to an unanswered request after a cancel. It waits at most `close_wait`, then sends `client_aborted` if a stream was chosen. A cancel before the request is sent still sends nothing.

**Stand-in:** `StandInDaemon::download_requests()` records every download request as sent.

## Public API (for the app wiring)
```rust
// pistudiodesktop_transfer::engine
pub const FINAL_CODES: [&str; 11];                          // re-exported next to ConnectError / Connector
impl<C: Connector> Engine<C> {
    pub fn wake(&self);                                     // ends a wait before the next dial at once; no-op otherwise
    // new/upload/save/cancel/cancel_all_and_close/snapshot unchanged in signature
}
pub enum ConnectionState { Closed, Connecting, Open, Waiting }   // Waiting.as_str() == "waiting"
// ConnectError { code, message, retry }: retry=false is final; retry=true is retried unless code ∈ FINAL_CODES (pub(super) fn retried())
// pistudiodesktop_transfer::upload
pub trait UploadSource: Send {
    fn size(&self) -> Option<u64>;
    fn read(&mut self, buf: &mut [u8]) -> impl Future<Output = io::Result<usize>> + Send;
    fn rewind(&mut self) -> impl Future<Output = io::Result<()>> + Send;   // NEW, required
}
```
- **App wiring:** call `engine.wake()` on connection_resume (wake, network change) and when `transport_open` succeeds for the same entry. Report the connector's retryable failures with `retry: true` (for example a stopped or starting local daemon).
- **Sprint 122's file source:** `rewind` should seek to 0 and re-read the metadata, so `size()` is current. Its `io::Error` text must carry no path.
- **Event callback:** it still runs under the engine lock for state changes, so it must not call the engine.

## Files changed
| File | Change |
|---|---|
| `src/engine/queue.rs` | recovery: `Conn::Waiting`, `lost`, `launch_waiting`, `wait_to_retry`, `backoff`, `wake`, `Unopened`, final or retried classification, `fail_all` skipping still-running transfers |
| `src/engine/work.rs` | `UploadWork` (rewind on later attempts, progress reset), `SaveWork` (keeps `Version`, resumes) |
| `src/engine/connector.rs`, `snapshot.rs`, `event.rs`, `src/engine.rs` | `FINAL_CODES`, `ConnectError::retried`, `ConnectionState::Waiting`, `Reporter::rewind`, `Engine::wake`, docs |
| `src/upload.rs`, `upload/memory.rs` | `rewind`, the early-cancel fix |
| `src/testing/{state,connection,server}.rs` | `download_requests()` |
| `src/engine/tests/recovery.rs` | new, 14 tests |
| other tests | `failures.rs` (two obsolete tests removed), `support.rs`, `upload/tests/{support,frames}.rs`, `testing/tests/downloads.rs` |
| `desktop/AGENTS.md`, `README.md`, `docs/architecture.md` | the `transfer` lines now describe recovery, `wake`, `rewind` and the early-cancel rule |

## Acceptance criteria
- [x] **Download cut after N bytes:** `a_save_cut_in_the_middle_resumes_at_its_bytes_with_the_guard_of_its_first_answer`.
  - The sink holds the exact file and the second request carries `offset` = 100000 and `ifUnchanged {size, mtimeMs}`.
  - `restarts` is 1 and the events are `[Waiting, Running, Waiting, Running]`.
- [x] **Upload cut:** `an_upload_cut_in_the_middle_starts_again_from_byte_0_with_a_new_transfer_id`.
  - The daemon ends with one whole file and one upload record, with `transfer_id` `client-1-1`.
  - Progress is back to 0 and `restarts` is 1.
- [x] **Refusals for a paused hour:** `a_daemon_that_refuses_for_an_hour_gets_attempts_after_1_2_4_8_16_then_30_seconds_and_the_transfers_complete`.
  - Both transfers stay `waiting` with a single event for the hour, then complete.
  - The gaps between attempts are checked for 1, 2, 4, 8, 16, 30 and 30 s.
- [x] **Wake:** `a_wake_ends_a_wait_of_30_seconds_at_once`. The clock does not move.
- [x] **401 and 502:**
  - `a_password_refused_at_a_reopen_fails_every_transfer_and_no_attempt_follows`: all 4 fail `unauthorized` (3 active, 1 queued), and 10 paused minutes add no attempt.
  - `a_gateway_error_of_the_upgrade_is_retried` uses a real 502 server and a 1 s then 2 s wait.
- [x] **Changed file:** `the_file_that_changed_between_the_drop_and_the_resume_is_changed_and_the_sink_is_discarded`.
- [x] **Cancel while waiting:**
  - `a_cancel_while_the_connection_is_not_there_settles_at_once_and_the_engine_stops_trying` and `a_save_cancelled_after_a_drop_while_it_waits_is_discarded`.
- [x] **Final vs retried codes:**
  - `the_final_codes_fail_at_once_and_a_connector_that_says_not_to_retry_is_final_too`.
  - `every_other_code_is_retried_the_handshake_included`.
  - `a_daemon_without_a_feature_is_not_retried_after_a_drop_either`.
- [x] **Early cancel:** two tests in `upload/tests/frames.rs`.
- [x] **`cargo xtask ci`:** passes.
- [x] **Mutation checks:** four temporary breaks were each caught by a test and the files restored. They were resume always `None`, no progress reset on rewind, `wake` as a no-op, and returning from an early cancel at once.

## Follow-ups / TODO(verify)
- **No path or handle in errors:** the new messages hold none; the rewind error uses `io::Error`'s text, so the file source must keep paths out of it.
- **Slow drop detection:** a transfer blocked in a slow sink write notices a dead connection only when the write returns. `fail_all` leaves such a transfer alone, so after a final error it can cost one extra dial before it fails with the same code.
- **Edits made with Python:** I changed some files with Python string replaces rather than the `edit` tool: `queue.rs`, `work.rs`, `connector.rs`, `engine.rs`, the docs and a few test files. Content is verified by the passing gates.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (task agent, single agent in the tree)
```
