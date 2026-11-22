# Task 003 — The engine: the queue, three at once, the connection on demand, progress and the snapshot — Summary

- **Sprint:** sprints/sprint-121-desktop-transfer-engine
- **Completed:** 2026-11-22
- **Status:** done. `cargo xtask ci` passes (all 8 steps).

## What was implemented

New module `engine` in `desktop/crates/transfer`, with these parts:
- `engine.rs`: the public `Engine<C: Connector>`.
- `engine/queue.rs`: the one state machine.
- `engine/work.rs`: type-erased uploads and saves.
- `engine/event.rs`, `engine/snapshot.rs`, `engine/failure.rs`, `engine/connector.rs`.

A new crate-root module `held.rs` holds the memory gauge.

**Behaviour:**
- **Starting.**
  - `upload` and `save` resolve at settlement with the bytes or a `Failure { code, message }`.
  - `id` is 1–64 characters of `A-Za-z0-9-`, else `invalid_request`.
  - An `id` that is active or queued is `duplicate_id`.
  - A path must be 1–4096 bytes, else `invalid_request` (spec § Error handling).
  - A refused save's sink is discarded.
- **Queue.**
  - At most `limits.max_transfers` (3) are active; the rest wait first in first out, with no limit.
  - Each transfer is in exactly one place: `queue`, `active`/`Waiting` (has a turn, connection not open yet) or `active`/`Running` (a task runs it).
- **Connection.**
  - It is dialled when the first transfer becomes active, and active transfers are `waiting` until it is open.
  - 30 s after nothing is active or queued it is closed with 1000.
  - A new transfer stops the timer, using an epoch counter so a stale timer is a no-op.
  - A connecting dial is aborted when nothing needs it any more.
  - A watcher task notices an open connection that ends.
- **Failures (this task only).**
  - A connection that cannot open fails every active and queued transfer with the connector's code, `unsupported_daemon` or `protocol`.
  - A drop fails the transfers on that connection with `connection_lost`.
  - A transfer lost that way has its save discarded.
  - Queued transfers dial a new connection.
  - A panic inside a transfer is caught and settles as `internal`.
- **Events.**
  - `{id, state: queued | running | waiting, done, total}` goes at every state change.
  - Progress events come at most once per `Limits::progress_interval` (100 ms) per transfer, and a state event counts toward that rate.
  - None come at settlement.
  - The callback runs under the engine lock for state changes, so it must not call the engine.
- **Cancel.**
  - A queued or waiting transfer settles at once as `cancelled`; a save is discarded first.
  - A running transfer is told through a `watch` and settles when its `upload`/`save` returns.
  - `cancel_all_and_close(Close)` cancels all, waits until every start has been answered, then closes with 1000 or 1001. The engine can be used again afterwards.
- **Snapshot.**
  - A synchronous read of connection state and opens, the active list (id, kind, state, done, total, restarts), queued count, totals, `peak_held` and `last_error { code, at_ms }`. There is no path.
  - `at_ms` is the wall time at engine creation plus tokio-clock elapsed time.
- **`peak_held`.** A `Held` gauge shared with the connection.
  - An upload counts one chunk buffer from the moment it runs.
  - A download counts the bytes of each frame the daemon sent and the sink has not written (`Delivery` carries a `Holding`).
- **Drop.** `Drop for Engine` cancels everything and hangs the connection up.

## Public API (for task 004 and the app wiring)

```rust
// pistudiodesktop_transfer::engine
pub trait Connector: Send + Sync + 'static {
    fn connect(&self) -> impl Future<Output = Result<pistudiodesktop_net::Socket, ConnectError>> + Send;
}
pub struct ConnectError { pub code: &'static str, pub message: String, pub retry: bool }
impl ConnectError { pub fn new(code: &'static str, message: impl Into<String>, retry: bool) -> Self }
impl From<DialError> for ConnectError          // retry = unreachable | timeout | handshake

pub struct Config { pub client_id: String, pub app_version: String, pub limits: Limits }
impl Config { pub fn new(client_id: impl Into<String>, app_version: impl Into<String>) -> Self }

pub struct Engine<C: Connector> { .. }
impl<C: Connector> Engine<C> {
    pub fn new(connector: C, config: Config, events: impl Fn(Event) + Send + Sync + 'static) -> Self;
    pub async fn upload<S: UploadSource + 'static>(&self, id: &str, path: &str, source: S) -> Result<u64, Failure>;
    pub async fn save<S: Sink + 'static>(&self, id: &str, path: &str, sink: S) -> Result<u64, Failure>;
    #[must_use] pub fn cancel(&self, id: &str) -> bool;
    pub async fn cancel_all_and_close(&self, how: Close);
    #[must_use] pub fn snapshot(&self) -> Snapshot;
}                                              // Drop: cancels everything, hangs the connection up

pub struct Failure { pub code: &'static str, pub message: String }   // Debug, Clone, Eq, Error
impl Failure { pub fn new(code, message) -> Self; pub fn cancelled() -> Self; pub fn internal(what: &str) -> Self }
pub struct Event { pub id: String, pub state: TransferState, pub done: u64, pub total: Option<u64> }
pub enum TransferState { Queued, Running, Waiting }                  // as_str()
pub enum ConnectionState { Closed, Connecting, Open }                // as_str()
pub enum Kind { Upload, Save }                                       // as_str()
pub struct Snapshot { pub connection: ConnectionInfo, pub active: Vec<ActiveTransfer>, pub queued: usize,
                      pub totals: Totals, pub peak_held: u64, pub last_error: Option<LastError> }
pub struct ConnectionInfo { pub state: ConnectionState, pub opens: u64 }
pub struct ActiveTransfer { pub id: String, pub kind: Kind, pub state: TransferState, pub done: u64, pub total: Option<u64>, pub restarts: u32 }
pub struct Totals { pub done: u64, pub failed: u64, pub cancelled: u64 }
pub struct LastError { pub code: &'static str, pub at_ms: u64 }

// pistudiodesktop_transfer::held
pub struct Held;     // new(), hold(bytes) -> Holding, now(), peak()
// pistudiodesktop_transfer::connection
impl Connection {
    pub async fn open_counting<S: Transport>(socket, &Hello, Limits, Held) -> Result<Self, Error>;  // open() delegates with a fresh gauge
    pub fn hang_up(&self);                                  // 1001, no wait; Drop uses it
}
// limits.rs: Limits.progress_interval (100 ms), PROGRESS_INTERVAL, MAX_PATH_BYTES (4096)
```

**App wiring:**
- Implement `Connector` by dialling the current entry with `net::dial(url, password, DIAL_LIMIT, limits.max_message_bytes)`. Map each `DialError` through `ConnectError::from`; the app's own errors (`secret_missing`, `no_current`, `not_bridged`, …) use `ConnectError::new`.
- Map `Event` to `transfer_progress` using `state.as_str()` and `total: Option`.
- Map `Snapshot` to `ui.inspect` `transfers`, adding `mode` and `entryId`. `connection.state` is `closed`, `connecting` or `open`; the control-socket value `waiting` is not produced until task 004.
- `Failure.code` and `message` map directly to the command's `{code, message}`.

**For task 004 (reconnect, wait, resume), the seams are:**
- `Ended::Lost(Failure)` in `engine/work.rs` is the "retry can help" outcome. Today `Inner::conclude` in `queue.rs` settles it as failed after discarding the save.
- `Inner::finish` already passes the connection `generation`, and `forget` closes only the matching connection.
- `Inner::opened` handles a dial result and `fail_all` handles a final failure. A retry branch uses `ConnectError::retry` (currently unread) and `Transfer.restarts`.
- A `waiting` state for active transfers already exists.
- `UploadWork::run` and `SaveWork::run` are `&mut self` and called once. An upload restart needs a rewindable or re-creatable source (`UploadSource` is read once). A save resumes with `Request { resume: Some(version) }`, so keep `Saved`/`ConnectionLost.version` in the work.
- `Connector` and `ConnectError.retry` are already in the shape the spec wants.

## Files created / changed

| File | Change |
|---|---|
| `src/engine.rs`, `engine/{queue,work,event,snapshot,failure,connector}.rs` | created |
| `src/held.rs` | created |
| `src/engine/tests.rs`, `tests/{support,queue,idle,events,cancel,failures,validation,snapshot,lifecycle}.rs` | created (54 engine tests in all, counting the unit tests in `event.rs`, `failure.rs` and `connector.rs`) |
| `src/lib.rs` | modified: `pub mod engine`, `pub mod held` and their module-doc lines |
| `src/limits.rs` | modified: `progress_interval`, `PROGRESS_INTERVAL`, `MAX_PATH_BYTES` |
| `src/connection.rs`, `connection/{shared,download,reader}.rs` | modified: the gauge (`open_counting`, `Delivery` holds a `Holding`), `hang_up` |
| `src/testing/{state,connection,server}.rs` | modified: the stand-in records client close codes; `client_closes()` |
| `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md` | `transfer` lines updated: the engine, the upload (which the earlier text left out), `held` |

## How it satisfies the scope

It follows spec § The queue, § 2 (`id`, event), § 3 (Close), § 8 (`transfers` minus `mode` and `entryId`), D6, D7, S3 and S5. I did not touch `swe/sprints/`. I did not unify the upload and save error and progress types (the owner allowed it). The engine adapts them in `work.rs`, so the existing tests stayed as they were.

Decisions:
- **Single lock, no actor.** State is under one `Mutex` and every decision is a short synchronous step. This makes `snapshot()` synchronous and the order of events well defined.
- **Connector returns `net::Socket`.** The engine does the `hello` itself.
- **Settlement path.** A save that is discarded after a lost connection settles from a small task that waits for the discard, so the answer says the file is gone.
- **`at_ms`.** It comes from tokio's clock on top of one wall-clock read at construction, so paused-clock tests are consistent.
- **Frozen-clock tests.** They use a `Frozen` helper (a parked blocking task that stops tokio's auto-advance, same idea as the connection tests) and `run_for`, which steps at most 5 s at a time. Big clock jumps race the connection's own ping and drop timers; my first version failed on that, as `a_transfer_started_at_29_seconds…` showed.

## Build & test results

```
$ cargo test -p pistudiodesktop-transfer      (5 separate runs)
329 passed; 0 failed in each run (about 1.3 s)
$ engine:: tests under load: 6 processes in parallel, 3 rounds
54 passed in all 18 runs
$ cargo clippy -p pistudiodesktop-transfer --all-targets --all-features -- -D warnings   -> clean
$ cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings                  -> clean (lib-only also clean)
$ cargo fmt -p pistudiodesktop-transfer -- --check   -> ok
$ cargo xtask layers   -> layering: ok (12 crates)
$ cargo xtask wasm     -> ok
$ cargo xtask ci       -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria

- [x] **Four transfers together: three run, the fourth is `queued` and starts when one settles; they settle in an order consistent with their sizes.**
  - Checked by: `four_uploads_started_together…` (snapshot has 3 active and 1 queued, events `[Queued]` then `[Queued, Running]`).
  - Checked by: `transfers_settle_in_an_order_consistent_with_their_sizes` (frozen clock, stand-in `chunk_delay`; saves of 2, 4, 6 and 2 chunks settle a, d, b, c).
  - Checked by: `the_queue_has_no_limit_and_runs_first_in_first_out` (10 transfers).
- [x] **Paused clock: the connection closes 30 s after the last transfer, and a transfer started at 29 s keeps it open.**
  - Checked by: `the_connection_closes_30_seconds_after_the_last_transfer` (still open at 29.99 s; closed at 30.01 s; the stand-in saw close code 1000).
  - Checked by: `a_transfer_started_at_29_seconds_keeps_the_connection_open` (the same connection is reused, still open at 31 s, closed 30 s after the second).
  - Also: `the_connection_is_not_idle_while_a_transfer_runs`, `a_transfer_after_the_connection_closed_opens_another`, `an_engine_with_no_transfer_never_dials`.
- [x] **At most 10 progress events a second and one event per state change.**
  - Checked by: `a_transfer_tells_at_most_ten_progress_events_a_second` (30 steps, 1.56 s of clock, ≤ 16 events, at least 13, strictly increasing).
  - Checked by: the unit tests in `event.rs` (`a_second_of_reports_is_at_most_ten_events`, the throttle).
  - Checked by: `a_transfer_tells_each_change_of_state_and_nothing_when_it_settles` (`[Waiting, Running]`, nothing after the answer).
- [x] **Cancel of a queued transfer, of an active one, and cancel-all settle the right transfers as `cancelled` and leave the totals right.**
  - Queued: `a_queued_transfer_cancels_at_once…` (totals 3 done, 1 cancelled, no `last_error`).
  - Active: `an_active_upload_cancels…` (the daemon's record says `client_aborted`), `an_active_save_cancels_and_is_discarded`.
  - Queued save: `a_queued_save_that_is_cancelled_is_discarded…`.
  - Waiting for the connection: `transfers_that_wait_for_the_connection_cancel…` (the dial is given up).
  - Cancel-all: `cancel_all_settles_every_transfer…` (5 cancelled, close code 1001, engine reusable), `cancel_all_while_the_connection_is_being_dialled…`.
- [x] **`cargo xtask ci` passes** (all 8 steps).

## Follow-ups / TODO(verify)

- **`ConnectError.retry` is not read.** Task 004 reads it. The docs say so.
- **`restarts` is always 0.** It exists in the snapshot for task 004.
- **`peak_held` approximations.**
  - An upload counts its chunk buffer from the moment it runs, including while the request is unanswered.
  - The frame copy `encode_chunk` makes is not counted.
  - A download counts a frame from decode until the sink has written it, including the frame waiting for hold room.
  - Task 007 should check the 5 GiB criterion against a real daemon.
- **Callback under the lock.** For a state change the events callback runs under the engine lock, so the app's callback must only emit and must not call the engine. This is documented.
- **Dropped call futures.** Dropping an `upload` or `save` future does not stop the transfer; the caller cancels. This is documented.
- **`cancel_all_and_close` waits for everything started.** The caller must stop starting transfers first; a transfer started while it waits is waited for too.
- **Test edits I made with Python.** I edited some test and doc files (`queue.rs`, `idle.rs`, `validation.rs`, `events.rs`, `support.rs`, and the three docs) with a Python string replace instead of the `edit` tool. Content was verified by the test and CI runs.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (run by the task agent, single agent in the tree)
```
