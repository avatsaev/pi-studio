# Task 002 — `net` crate: the loopback proxy (the page's leg, the pump, limits, the set of connections)

- **Sprint:** sprint-115-desktop-bridge-core
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/net, desktop/apps/ipc-bench
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-001

## Goal
Given an open WebSocket to a daemon, the `net` crate answers a local URL; a client that connects to it with the right token, origin and host exchanges messages with the daemon unchanged and in order, and no other client can.

## Context / why
Decision T5 (2026-11-22): the channel design failed the benchmark gate, and the owner chose a loopback WebSocket proxy owned by Rust. This is the part that carries frames. It is tested without Tauri: the "page" in the tests is a WebSocket client. The benchmark's `proxy.rs` is the measured sketch (it has no TLS, no password, no `Host` check and no size cap).

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (limits), § 3 (the page's leg, the pump, what Rust holds, closing), § 7 (states, counters, `lastError`), decisions T5, P11, P13, P15, P16, § TODO(verify) (parts the benchmark's proxy did not have)
- `desktop/apps/ipc-bench/src/proxy.rs` (the sketch: the gate, the per-connection listener, the pump, the tests), `swe/notes/desktop-ipc-benchmark.md` § What the loopback proxy costs
- `desktop/crates/net/` (the dial of task-001, `limits.rs`)
- `desktop/AGENTS.md` (never crash, no `unsafe`, licences), `desktop/xtask/src/layers.rs`

## What to build
- **Opening the page's leg.** From an open daemon socket and the expected origin: bind `127.0.0.1` on a port the system chooses, make a token (256 random bits, 64 hexadecimal digits), start a task, and answer `ws://127.0.0.1:<port>/<token>`. A failure to bind or to get random bytes is `proxy_failed`.
- **The gate.** Exactly one upgrade is accepted: its path is the token (constant-time compare; a wrong guess does not use it up; a second use is refused), its `Origin` equals the expected origin, its `Host` is `127.0.0.1:<port>`. The page offers no subprotocol and none is answered. A refusal is a bare 403 that does not say which check failed; the reason is kept for the log and for `lastError`, without the token. At most 16 upgrades in progress, each given 2 s.
- **Lifetime.** The listener is dropped when the upgrade is accepted or after 10 s. With no page in time the daemon's leg is closed with 1001, the connection forgotten and `lastError` set to `page_timeout`.
- **The pump.** One task per direction; a message passes unchanged and in order, text as text, binary as binary. Each leg answers its own WebSocket pings; pings and pongs are not passed on; none is sent. A direction reads its next messages only when the write of the previous ones has completed: at most a write batch (256 KiB or 64 messages) and one message are held per direction, and a peak counter records the most that was held.
- **Closing**, as § 3's table: a close frame from either leg reaches the other with its code and reason (wait up to 2 s for the answer, then drop); a leg that ends without a close frame drops the page's leg (the page sees 1006) or closes the daemon's with 1001; a message above 128 MiB closes both legs with 1009.
- **The set of connections.** At most 4 (waiting for the page, or open): a fifth is `limit`. Close all (1001 to each daemon, page legs dropped). A snapshot for `ui.inspect`: entry id (given by the caller), state (`connecting`, `open`, `closing`), frames and bytes each way, and the last abnormal end (`page_refused`, `page_timeout`, `upstream_lost`, `too_large`) with its time.
- **P16.** `codec.rs`, `window.rs` and `order.rs` (and what only they use in `testing.rs`) move into `desktop/apps/ipc-bench`, which is their only user; `limits.rs` stays. The benchmark still builds and its tests pass.
- **P14.** The benchmark's rule for B4 memory growth (`desktop/apps/ipc-bench/page/compare.js`) becomes "no more than the baseline's growth in the same run, plus 64 MiB", with its test. No benchmark run is part of this task.
- `desktop/docs/architecture.md` and `desktop/AGENTS.md` (the workspace map's line for `net`) say what the crate holds now.

## Out of scope
- The Tauri command, reading the webview's origin, the secret store (sprint 116).
- TLS and the password: the dial of task-001 already gave an open socket.
- Any change to the benchmark's measurements.

## Acceptance criteria
- [ ] Against a local echo server: text and binary messages are echoed as they are; 100,000 mixed messages arrive in order with equal hashes in both directions.
- [ ] A wrong token, a wrong origin, a wrong host and a second use of the token are each refused with 403; after a wrong guess the right client still connects; after the accepted upgrade the port refuses connections.
- [ ] With no client for the token's lifetime (shortened in the test) the daemon's leg sees 1001 and the snapshot is empty with `lastError` `page_timeout`.
- [ ] A client that does not read stalls a flood from the server, and the peak counter stays at or under 256 KiB plus one message; reading again loses nothing.
- [ ] A close with a code and reason from each side reaches the other unchanged; a server that resets ends the client without a close frame; a client that vanishes gives the server 1001; a 129 MiB message closes both legs with 1009 (the test may lower the cap).
- [ ] A fifth connection is `limit`; closing all leaves none and each server saw 1001.
- [ ] The token and the local URL appear in no error, log line or snapshot (a marker test).
- [ ] The benchmark application builds with the moved modules and its own tests pass; `cargo xtask ci` passes, including the layer and wasm steps.

## Test / verification plan
- `cargo test -p pistudiodesktop-net -p pistudiodesktop-ipc-bench`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: a misbehaving client or server (a frame that is too large, invalid UTF-8 in a text frame, a close in the middle, a half-open socket) ends in a closed connection and a `lastError`, never a panic.
- The layer table lets only the app binaries depend on `net`; check that `net` itself cannot depend on `tauri` (a hole suspected in sprint 112), and say what you found.
- A blocked page is not this task's problem: the webview buffers (P15). The bound proved here is Rust's.
