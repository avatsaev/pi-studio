# Task 003 — A stand-in daemon for the engine's tests — Summary

- **Sprint:** sprints/sprint-120-desktop-transfer-wire
- **Status:** done. `cargo xtask ci` was not run, as assigned; only the narrow gates below were.

## What was implemented
`pistudiodesktop_transfer::testing`: a WebSocket daemon in the test's own process, on `127.0.0.1` with an OS-assigned port.
- **API:**
  - `StandInDaemon::start()` and `start_with(Config)`, then `url()` and `port()`.
  - `put_file`, `put_file_at`, `remove_file`, `file`, `file_info`.
  - `script(Fault)` and `pending_faults()`.
  - `hellos()`, `uploads()`, and the counters `accepted_connections()`, `open_connections()` and `refused_upgrades()`.
  - Dropping the daemon closes its connections.
- **`Config`:**
  - `password`.
  - `features`: the three flags the engine reads. A flag that is off is left out of `status`, as an older daemon leaves it out.
  - `chunk_bytes`, default 32 KiB.
  - `chunk_delay`, so a test can cancel or drop a download in flight.
  - `stream_slots`, default 256, so a test can get a real `no_free_stream`.
- **Upgrade:** with a password set, an upgrade that does not offer `pi-studio.bearer.<password>` gets `HTTP 401`. The bearer subprotocol is echoed back.
- **`hello`:**
  - It is answered with `status` (`server_info`), shaped like the fixture.
  - A first frame that is binary, not JSON, or not a valid `hello` closes the socket with 1008, with the real daemon's reasons.
  - Each accepted hello is kept for `hellos()`.
- **`ping`:** answered with `pong`. A request of an unknown type gets `rpc_error` `unknown_message_type`.
- **Uploads:**
  - Held in memory. The file is stored at its path only when `End` arrived after a `Begin` with the right `transferId`.
  - A client `Error` frame, a missing `Begin`, or a lost connection keeps nothing.
  - `file_upload_complete` is sent when the request had `ack`. The real daemon ignores `End`'s `ok` byte, and so does the stand-in.
  - Refusals: `missing_fields` and `no_free_stream`. Streams come from a rotating cursor starting at 1, and a finished upload frees its stream.
- **Downloads:**
  - The answer goes first, then `Begin`, `Chunk`s, `End`.
  - The checks run in the real daemon's order: `missing_path`, `invalid_stream`, `invalid_range`, `no_free_stream`, `stream_in_use`, `not_found`, `range_not_satisfiable`, `changed`.
  - `changed` carries the file's current `totalBytes` and `mtimeMs`.
  - A running download keeps the version it started with.
  - A cancel is answered first, then the download sends `Error cancelled` and no `End`. A cancel for a stream that is not running gets `ok: false, not_found`.
- **Faults:**
  - Connection faults, each fired `After` a count of bytes, binary frames or text frames, in either direction, or at the start: `Close{code}`, `Reset` (RST via a zero linger), `StopReading`, `StopAnswering`. Bytes to the client are cut exactly: the last chunk is sent short.
  - `Refuse{request, error}` (with `Fault::no_free_stream` as a shortcut), `RpcError`, and `Silence` for `Hello`, `Ping`, `Upload`, `Download` or `Cancel`.
  - Upload faults: `UploadFails{error}` and `WrongBytesWritten{reported}`.
  - `DownloadStream(StreamFault)`:
    - `ErrorFirst`
    - `OutOfOrder(ChunkBeforeBegin | EndBeforeChunks | ChunkAfterEnd | ChunkOnOtherStream)`
    - `Oversized(n)`
    - `ExtraBytes(n)`
    - `ErrorAfter{bytes, message}`
  - Each fault is used once, by the first connection that reaches it.
  - "Change a file between two requests" is `put_file` between the requests. `ErrorAfter` with message `changed` covers a file that shrinks while a download runs.
- **Not in a release build:** `testing` is a cargo feature (`dep:tokio`, `dep:tokio-tungstenite`, `dep:futures-util`, `dep:socket2`, all optional) plus `cfg(test)`. The app is to list the feature only in its `[dev-dependencies]`. I did not touch the app.

## Files created / changed
| File | Change |
|---|---|
| `desktop/crates/transfer/Cargo.toml` | `testing` feature; optional deps; dev-deps for this crate's own tests |
| `desktop/Cargo.lock` | the crate's dependency list (+4 lines) |
| `desktop/crates/transfer/src/lib.rs` | `#[cfg(any(test, feature = "testing"))] pub mod testing;` and its module-doc line |
| `src/testing.rs` | created: module docs and re-exports |
| `src/testing/{fault,frames,state,server,connection,download}.rs` | created |
| `src/testing/tests.rs`, `tests/{client,handshake,uploads,downloads,faults,stream_faults,pinned}.rs` | created: 57 tests |
| `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md` | `transfer` row updated for `testing` |

## How it satisfies the scope
- The stand-in builds its own frames in `frames.rs`, without `wire`'s encoders. It reads the client's binary frames with `wire::binary::decode`. A test client built on `wire` (`outbound`, `inbound`, `binary`) and dialled through `net::dial` therefore checks two independent writers against the same fixtures.
- `pinned.rs` sends the fixtures' own request frames and compares each frame the stand-in sends with its fixture, except at the `volatile` pointers. Covered:
  - `status.server_info` (extra feature flags removed from the actual frame before comparing)
  - `pong`
  - `rpc_error`
  - the upload response and `file_upload_complete`
  - the download response, and the rejected one
  - `file_download_cancel_response` (the not-found fixture)
  - download `Begin`, `Chunk`, `End` and `Error`, compared byte for byte with the stream byte aside
- The `hello` and `hello.agentStreams` fixtures are both accepted.
- Deviations: none.

## Build & test results
```
$ cargo test -p pistudiodesktop-transfer
98 passed; 0 failed (41 wire + 57 testing); run 4 times, stable
$ cargo test -p pistudiodesktop-transfer --features testing
98 passed; 0 failed
$ cargo clippy -p pistudiodesktop-transfer --all-targets --all-features -- -D warnings
clean (and the same without the feature)
$ cargo fmt -p pistudiodesktop-transfer -- --check      -> ok
$ cargo xtask layers   -> layering: ok (12 crates)
$ cargo xtask wasm     -> ok (transfer is empty on wasm32)
$ cargo build -p pistudiodesktop-transfer --release            : "StandInDaemon" occurs 0 times in the rlib
$ cargo build -p pistudiodesktop-transfer --release --features testing : 22 times
$ cargo tree -p pistudiodesktop-transfer -e normal --depth 1   -> net, serde_json, thiserror only
```

## Acceptance criteria
- [x] A client written with the `wire` module completes a handshake, an upload and a ranged download, and observes each named fault.
  - Handshake, upload and ranged download: `handshake.rs`, `uploads.rs`, `downloads.rs`.
  - Faults: `faults.rs` and `stream_faults.rs`.
  - Close or reset after N bytes or frames, in either direction.
  - Stop reading, stop answering.
  - `ok: false` with a chosen error, and `no_free_stream`, both scripted and real.
  - A file changed between two requests.
  - A wrong `bytesWritten`.
  - A frame out of order, an oversized message, an `Error` first, more bytes than `length`.
- [x] The stand-in is not compiled into a release build of the app. It is behind a feature plus `cfg(test)`, and the rlib check above shows 0 symbols without the feature.
- [~] `cargo xtask ci` was not run, as assigned. The narrow gates above are green.

## Follow-ups / TODO(verify)
- Sprint 122: the app must list `pistudiodesktop-transfer = { workspace = true, features = ["testing"] }` in its `[dev-dependencies]` only, or the feature reaches a release build.
- It does not emulate the real daemon's pacing (the 1 MiB high-water read pause). Only `chunk_delay` and the channel's backpressure slow a download. The real daemon is checked later in sprint-122/task-007 and sprint-123/task-001.
- It has no 403 (`PI_STUDIO_HOSTNAMES`) and does not expand `~` in paths.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
desktop frontend: npm run snapshot -> wrote snapshot.png, no CSP violation
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```
