# Task 004 — The bulk connection: handshake, requests, liveness (D6, S3)

- **Sprint:** sprint-120-desktop-transfer-wire
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/transfer/src
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
From an open socket, the crate has a connection that has said `hello`, matches answers to requests, knows when the daemon is gone, and hands frames of a transfer to whoever runs it.

## Context / why
T4 of milestone 2 left the handshake and request matching in TypeScript for the page's connection. The bulk connection is Rust's own, so Rust does both here for the first time.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 3 (every row), decisions D6, S3, R1
- `packages/client/src/daemon-client.ts` (the handshake, `request`, the answer to an inbound `ping`: the behaviour to match)
- `desktop/crates/net` (`Socket`), the wire of task-002, the stand-in of task-003

## What to build
- From a `net::Socket`: send `hello`; wait up to 30 s for `server_info`; without `fileDownloadRanges`, `fileTransferAck` and `agentStreamsMode` the connection fails with `unsupported_daemon`.
- Requests: a fresh `requestId` each; the answer is awaited 30 s; an `rpc_error` with that id is the request's error; a late answer is dropped.
- Liveness: after 10 s without any frame from the daemon, send a `ping`; after 30 s without any frame, the connection is dropped. An inbound `ping` is answered with a `pong`.
- Routing: `file_upload_complete` goes to the upload with that `transferId`; a binary frame with opcode `0x10`–`0x13` goes to the download on that stream; everything else is ignored.
- Closing: 1000 or 1001 on request, within the close wait; a dropped connection tells every waiter once, with a reason.
- Time comes through tokio's clock so that tests can pause it; no test sleeps for real seconds.

## Out of scope
- The queue, the retry, the transfers themselves (sprint 121).

## Acceptance criteria
- [ ] Against the stand-in: a handshake; a request and its answer; an `rpc_error`; an answer that never comes (30 s, paused clock) fails that request and leaves the connection open.
- [ ] A daemon that stops answering is declared dropped after 30 s and a `ping` was sent at 10 s; a daemon that keeps sending chunks is never pinged.
- [ ] A daemon without one of the three flags gives `unsupported_daemon`.
- [ ] A message above 16 MiB, invalid UTF-8 and a `status` of the wrong shape end the connection with `protocol`; nothing panics.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: no unwrap, expect or panic outside tests, no unsafe; every size is checked before it is used.
- The connection holds nothing per transfer beyond what is in flight: its memory does not grow with a file.
