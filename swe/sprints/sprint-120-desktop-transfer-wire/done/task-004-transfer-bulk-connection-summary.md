# Task 004 summary: the bulk connection (D6, S3)

## What was built

`desktop/crates/transfer` now has a `connection` module: the engine's own session with the daemon, run over a WebSocket.

- **`Connection::open`** takes a `WebSocketStream<S: Transport>`, a `Hello{client_id, app_version}` and `Limits`.
  - `net::Socket` is one instance of `Transport`. Tests use an in-memory pipe.
  - It sends `hello` and waits up to 30 s for `server_info`.
  - A missing `fileDownloadRanges`, `fileTransferAck` or `agentStreamsMode` gives `UnsupportedDaemon`.
  - A `status` of the wrong shape, including `features` that is not an object, gives `Protocol`.
  - It then starts a reader task and a writer task.
- **`request`** sends a `session` frame with a fresh `requestId`. It returns the answer with that id.
  - An `rpc_error` with that id is `Error::Rpc` for that request only.
  - After 30 s with no answer it returns `Timeout` for that request alone. The connection stays open and a late answer is dropped.
- **`send_text` / `send_binary`** return when the frame is on the socket.
- **`expect_upload(transferId)`** gives an `UploadWait` for the one `file_upload_complete` with that id.
- **`download()`** takes a stream id from 0 to 255 and returns a `Download` of `Delivery` values.
  - The reader takes no frame off the socket while the consumer holds more than `download_hold_bytes` unreleased.
  - So memory does not grow with a file, and the other transfers wait behind a slow download.
- **Liveness:**
  - One `ping` after 10 s with no frame of any kind from the daemon.
  - The connection is dropped (`Ended::Silent`) after 30 s.
  - Time spent blocked on a consumer does not count, so a daemon that keeps sending chunks is never pinged.
  - An inbound `ping` is answered with a `pong`.
- **Protocol errors:** a message above 16 MiB, text that is not UTF-8, or a frame `wire` cannot read ends the connection with `Error::Protocol` and a 1002 close.
- **Routing:** anything else is ignored. That means a text frame nobody awaits, an opcode outside 0x10–0x13, and a frame on a stream nobody downloads on.
- **Ending:** every waiter is told once, with the reason.
  - A download first gets what was already queued.
  - Every later call fails with the same reason.
  - `ended()` waits for the end and returns the reason.
  - `close(Close::Normal | Close::GoingAway)` sends 1000 or 1001 and waits `close_wait` (2 s) for the daemon's reply.
  - Dropping the connection ends it as `Local` with a 1001.
- **`error.rs`:**
  - New `Ended` enum (`Local`, `Remote(Option<u16>)`, `Silent`, `Socket`).
  - `Error` gained `Rpc`, `Closed(Ended)` and `Internal`.
- **`limits.rs`:** added `CLOSE_WAIT` and `Limits.close_wait`.
- **`wire` (small additions):**
  - `binary::is_file_transfer(opcode)`.
  - `server_info.features` that is present, non-null and not an object is now `Error::Protocol`.
- **`Cargo.toml`:** `tokio`, `tokio-tungstenite` and `futures-util` are now normal native dependencies.
  - `testing` is now `["tokio/net", "dep:socket2"]`.
  - `Cargo.lock` is unchanged.

## Files changed

- Source: `connection.rs` and `connection/{download,failure,handshake,reader,shared,writer}.rs` (new). Edited: `error.rs`, `lib.rs`, `limits.rs`, `wire/binary.rs`, `wire/inbound.rs`, `Cargo.toml`.
- Tests: `connection/tests.rs` and `connection/tests/{support,handshake,requests,liveness,routing,closing,ending,backpressure,hostile,standin}.rs` (new). Edited: `wire/tests.rs`, with two new tests.
- Docs:
  - `desktop/AGENTS.md` (`crates/transfer` entry);
  - `desktop/README.md` (`crates/transfer` row);
  - `desktop/docs/architecture.md` (L8 `transfer` row).
- Nothing under `swe/sprints/`, `crates/shell` or `apps/pistudiodesktop` was touched.

## Commands run (all in `desktop/`)

- `cargo test -p pistudiodesktop-transfer`: 182 passed, 0 failed. Run 9 times in separate runs after the last test fixes, with no flake; one earlier run had a flaky frozen-clock test, which I fixed.
- Stress: the test binary's `connection::` tests (81) run 6 at a time, 3 rounds. All 18 runs passed.
- `cargo test -p pistudiodesktop-transfer --features testing`: 182 passed.
- `cargo clippy -p pistudiodesktop-transfer --all-targets --all-features -- -D warnings`: clean. Also clean without `--all-features`, and lib-only.
- `cargo fmt -p pistudiodesktop-transfer -- --check`: clean.
- `cargo xtask layers`: `layering: ok (12 crates)`.
- `cargo xtask wasm`: passes. The crate is still empty on wasm32.
- `cargo build -p pistudiodesktop-transfer --release`: no `StandInDaemon` symbol in the rlib. `cargo tree -e normal --depth 1` now lists futures-util, net, serde_json, thiserror, tokio and tokio-tungstenite.
- Not run, as assigned: `cargo xtask ci` and any root `npm` command.

## Acceptance criteria

| Criterion | Status | Where covered |
|---|---|---|
| Against the stand-in: handshake, request and answer, `rpc_error`, no answer at 30 s on a frozen clock fails that request and leaves the connection open | Met | `standin.rs`: `the_hello_the_stand_in_reads…`, `a_request_and_its_answer`, `an_rpc_error_is_that_requests_error…`, `an_answer_that_never_comes_fails_that_request_after_30_seconds…`, `server_info_that_never_comes_is_a_timeout…` |
| A daemon that stops answering is dropped at 30 s, with a ping at 10 s | Met | `standin.rs`: `a_daemon_that_stops_answering_is_pinged_at_10_seconds_and_dropped_after_30`, `the_ping_goes_out_at_10_seconds`; exact times also in `liveness.rs` on the in-memory pipe |
| A daemon that keeps sending chunks is never pinged | Met | `standin.rs`: `a_daemon_that_keeps_sending_chunks_is_never_pinged`; `liveness.rs` |
| A daemon without one of the three flags gives `unsupported_daemon` | Met | `standin.rs` (all three flags, and the stand-in's connection count returns to 0); `handshake.rs` |
| A message above 16 MiB, invalid UTF-8 and a wrong-shape `status` end the connection with `protocol`; nothing panics | Met | `hostile.rs`: exactly 16 MiB accepted and +1 byte refused, for both binary and text; invalid UTF-8; table of broken text frames, including bad `features`; broken `Begin` on a running vs unregistered stream; seeded loop of 1500 random frames. Also `handshake.rs` and a stand-in test with an oversized chunk |
| `cargo xtask ci` passes | Not run (assigned not to); the narrow gates above are green | n/a |

## Notes for the orchestrator

- **Frozen-clock tests.** The tests that need 10 s or 30 s against the stand-in over a real socket use a `Frozen` helper. It calls `tokio::time::pause()` and parks a `spawn_blocking` task, which stops tokio from auto-advancing time. The test then advances the clock by hand. Two details matter:
  - Tokio rounds timer deadlines up to the next millisecond, so `advance` moves 2 ms more than asked.
  - A test must `settle()` before moving the clock after spawning a task, or that task's timer starts late.
  - The tests spend about 1 s of real time in total, in short real pauses. None sleeps for seconds.
- **Left to sprint 121.** Closing an idle connection (`idle_close`), reconnecting, the queue and the transfers themselves.
- **Design choices.**
  - `Connection::open` is generic over the stream, so the paused-clock tests can run in memory.
  - The caller supplies `transferId`, so no random-id dependency was added.
  - A file-transfer opcode on a stream nobody downloads on is ignored, not a `Protocol` error.
- **Docs.** The three doc files describe what the code does now.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
```
