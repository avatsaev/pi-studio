# Task 002 — `net` crate: a connection's tasks, limits and handles

- **Sprint:** sprint-115-desktop-bridge-core
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/net
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
An open socket becomes a connection with a read side that respects the inbound window, a write side that keeps `seq` order, and counters.

## Context / why
This is the part of the bridge that carries frames. It delivers to a sink the caller provides, so it is tested without Tauri, and the app binary later plugs the channel in.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (limits, handles), § 3 (the channel's messages, the window, the order), § 7 (counters), § Error handling
- `desktop/crates/net/` (codec, window, order buffer, dial)
- `swe/notes/desktop-ipc-benchmark.md` (the encoding the gate chose)

## What to build
- A connection owns the socket and two tasks. Read: WebSocket messages become channel messages in the encoding the benchmark chose, passed to a sink; reading pauses while the window is full. When the socket ends, the sink gets `closed` with the code and reason, or 1006 with an error when there was no close frame, and nothing after it.
- Write: a send carries `seq`; frames are written in order through the order buffer; the caller is answered when its frame was written. A gap that times out closes the connection with `send_order`, and so does a duplicate or an already-used `seq` and a 65th early message. **Added at wave 1 (2026-11-21):** the order buffer bounds early frames by count only; this task adds a 16 MiB cap on the bytes of waiting frames (over it is `send_order`), in the connection task or in the buffer.
- Close: send a close frame with the code and a reason of at most 123 bytes, wait up to 2 s for the peer's, then drop the socket.
- A message above 128 MiB is `too_large` for a send, and inbound closes with 1009.
- Counters per connection: frames and bytes in and out.
- A set of connections: at most 4, each under a random 128-bit handle; close all with a code; look up by handle.

## Out of scope
- The Tauri commands and the channel (sprint 116).
- Passwords: the dial of task-001 already took one.

## Acceptance criteria
- [ ] Against a local echo server: frames sent with shuffled `seq` within 64 are echoed in order; 100,000 mixed frames arrive in order with equal hashes.
- [ ] With a sink that does not acknowledge, the read side stops at the window and the server's writes stall; acknowledging resumes it and nothing is lost.
- [ ] A peer close with a code and reason reaches the sink unchanged; a dropped socket gives 1006 and an error; nothing is delivered after `closed`.
- [ ] A fifth connection is refused with `limit`; closing all leaves none and each sink got `closed` with the code given.
- [ ] A send after `closed` answers `closed`; an unknown handle answers `unknown_handle`.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-net`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: a misbehaving server (a frame that is too large, invalid UTF-8 in a text frame, a close in the middle) ends in an error and `closed`, never a panic.
