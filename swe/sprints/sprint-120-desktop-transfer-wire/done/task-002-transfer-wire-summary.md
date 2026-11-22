# Task 002 — Wire: the envelopes and the file-transfer frames, tested against the published fixtures (D20) — Summary

- **Sprint:** sprints/sprint-120-desktop-transfer-wire
- **Status:** done. The last `cargo xtask ci` acceptance item was not run, as assigned (see Acceptance criteria).

## What was implemented
New module `wire` in `desktop/crates/transfer`. It has no socket, no clock and no state.
- **`wire/outbound.rs`:** builds the text frames the engine sends.
  - `hello(client_id, app_version)` sends `clientType: "browser"`, `platform: "desktop"`, `agentStreams: "none"` and `protocolVersion: 1`. It has no `capabilities`.
  - `upload_request` carries `ack: true`.
  - `download_request(&DownloadRequest)` takes an optional `stream`, `offset`, `length` and `IfUnchanged { size, mtime_ms }`.
  - `download_cancel_request`, `ping`, and `pong(request_id, client_sent_at?, received, sent)`.
- **`wire/inbound.rs`:** `Inbound::parse(&str)` returns one of these variants:
  - `ServerInfo` holds the three flags. A flag the daemon does not list reads as false. `require_features()` returns `Error::UnsupportedDaemon { missing }` for the first one missing.
  - `Reply { request_id, kind, fields }` keeps the whole message. Its typed readers are `upload_response()`, `download_response()` and `cancel_response()`. A reader called on a reply of another kind fails.
  - `RpcError`, `UploadComplete`, `Ping`, `Pong`.
  - `Other { kind }` holds only the `type`. A `session` message uses its own `type`.
- **`wire/binary.rs`:**
  - `decode(&[u8]) -> FileFrame`. `Chunk` borrows its bytes from the frame. `Begin` carries the whole metadata as `BeginMeta`.
  - Encoders: `encode_begin` (only `transferId`), `encode_chunk`, `encode_end`, `encode_error`.
  - A missing `End` byte counts as ok, as the SDK reads it.
- **`wire/fields.rs`:** typed field readers shared by the other modules.

Decisions:
- **Sizes:** every number from the daemon must be a whole number from 0 to 2^53 − 1 (what Zod's `.int()` accepts) and is kept as a `u64`. Negatives, floats, strings, 2^53 and larger are `Error::Protocol`. A stream must be 0–255.
- **Hostile input:**
  - Errors are `Error::Protocol` and never echo what the daemon sent.
  - A text or binary frame above the 16 MiB message limit is refused before it is read.
  - A `Begin` payload above 64 KiB is refused.
  - No length from a frame is used to reserve memory.
- **Malformed frames:** a text frame that is not a JSON object with a string `type` is an error. So is a `session` frame without a `message` object, and a ping or pong without a string `requestId`. The SDK ignores such frames. This follows the spec's "a broken frame closes the connection with `protocol`".
- **Dependency:** `serde_json` (already in the workspace) was added to the crate's native-only dependencies. `Cargo.lock` gained one line for it.

## Files created / changed
| File | Change |
|---|---|
| `desktop/crates/transfer/Cargo.toml` | `serde_json` added (native only) |
| `desktop/Cargo.lock` | `serde_json` in `pistudiodesktop-transfer`'s dependencies |
| `desktop/crates/transfer/src/lib.rs` | `pub mod wire` and its line in the module doc |
| `desktop/crates/transfer/src/wire.rs`, `wire/fields.rs`, `wire/outbound.rs`, `wire/inbound.rs`, `wire/binary.rs` | created |
| `desktop/crates/transfer/src/wire/tests.rs`, `wire/tests/hostile.rs` | created (fixture tests, hostile loop) |
| `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md` | `transfer` rows/lines updated to describe `wire` |

## How it satisfies the scope
It follows spec §3–§5 and D20. Tests read the fixtures from `packages/protocol/fixtures/external-clients/` through `CARGO_MANIFEST_DIR/../../../…`, the same way `model` reads its vectors.
- **Outbound frames:**
  - Each is compared with its fixture's `frame`.
  - At each `volatile` pointer the value must be present with the same JSON type, and the value itself is ignored. Every other value is compared exactly.
  - For `hello`, `capabilities` is removed first, and the test asserts the fixture still has it.
  - A change in a fixture's shape fails the test.
- **Inbound fixtures:** each is read into the expected value. This covers `status.server_info`, `ping`, `pong`, `rpc_error`, the upload response, `file_upload_complete`, both download responses and both cancel fixtures (`file_download_cancel_request` is outbound, `file_download_cancel_response` inbound).
- **Binary fixtures:** all five are decoded to their `decoded` form. For `Begin`, the fixture's `hex` payload is also compared as parsed JSON against its `meta`. `Chunk`, `End` and `Error` are re-encoded to the same bytes. The upload `Begin` is checked to carry only `transferId`.
- **Hostile loop:** a seeded xorshift generator, with the same seed on every run.
  - Every prefix of every top-level fixture frame (80+ files) must be an error as text, and the whole frame must parse.
  - Every prefix of every binary fixture is checked.
  - 20,000 random binary frames, 20,000 mutated and 5,000 random text frames.
  - 100,000-deep nesting, 5,000-digit numbers and odd Unicode.
  - A frame of exactly the message limit is accepted. One byte more is refused.
- **Deviations:** none. `DownloadRequest` has an optional `length` that the engine never sets. The range fixture carries `length`, so the request builder has to be able to send it to match.

## Build & test results
```
$ cargo test -p pistudiodesktop-transfer
41 passed; 0 failed (doc-tests: 0)

$ cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings
clean (after replacing one OR pattern with a range in hostile.rs)

$ cargo fmt -p pistudiodesktop-transfer -- --check     -> ok
$ cargo xtask layers   -> "layering: ok (12 crates)"
$ cargo xtask wasm     -> ok (transfer checked, empty on wasm32)
```

## Acceptance criteria
- [x] Every fixture named in the task is used by a test, and the tests fail if a fixture's shape changes (`assert_matches_fixture`, pointer checks and fixture-derived expected values in `wire/tests.rs`). That includes `hello.agentStreams`, `status.server_info`, `ping`, `pong`, `rpc_error`, the upload and download fixtures, both cancel fixtures, and the five `binary/file_transfer.*` fixtures.
- [x] A seeded loop of random and truncated input, text and binary, never panics, and nothing is reserved from an unchecked length (`wire/tests/hostile.rs`, plus `a_frame_over_the_message_limit_is_refused_before_it_is_read` in `wire/tests.rs`).
- [x] Sizes and offsets are 64-bit. 5 GiB and 2^53 − 1 are read exactly in the download response, `file_upload_complete` and `Begin` (`sizes_of_5_gib_and_2_pow_53_minus_1_are_read_exactly`). 2^53 is refused.
- [~] `cargo xtask ci` was not run, as assigned. The sibling-owned `desktop/crates/shell/src/saves.rs` and TypeScript files are changing concurrently. The narrow gates listed above are green.

## Follow-ups / TODO(verify)
- `Error::Protocol(String)` is used as it is. The task-001 `Error` enum did not need new variants.
- The engine (task-004 and sprint 121) still has to check a download's `offset + length` against `totalBytes` and count the bytes that arrive. The doc comment on `DownloadAccepted` says so.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 295 files, 4204 tests passed
(first run: 2 failures in packages/workbench/src/host/files.test.ts, caused by sprint-119/task-002 removing the setStatus dep; the tests were moved onto the activity store and the gate re-run)
cargo xtask ci (desktop/) -> all 8 steps passed, including shell's process tests
```
