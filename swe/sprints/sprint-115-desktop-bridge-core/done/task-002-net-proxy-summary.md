# Task 002 — `net` crate: the loopback proxy — Summary

- **Sprint:** sprint-115-desktop-bridge-core
- **Completed:** 2026-11-22
- **Status:** done

## What was built
`desktop/crates/net/src/proxy/`:
- **API.** The page's leg opens in two steps: `Proxies::reserve(id)` (before the dial, so a fifth connection is `limit` without dialling) then `Reservation::open(daemon_socket, origin)` returning a `LocalUrl` (its `Debug` prints nothing; `expose` gives the text). `Proxies::new(log)` / `with_limits`, `close_all()`, `snapshot()` (id, state, frames and bytes each way, `peak_held_in`/`peak_held_out`, last abnormal end with its time). `Limits::default()` holds the shipped values; tests pass shortened ones.
- **Gate and listener.** One listener per connection on `127.0.0.1`, a 256-bit token compared in constant time, `Origin` and `Host` checks, bare 403 for any refusal, a wrong guess does not use the token up, at most 16 upgrades read at once for 2 s each, no subprotocol answered; the listener is dropped on accept or after 10 s.
- **Pump.** One task per direction, batch 256 KiB / 64 messages plus one message held, 128 MiB cap (1009 on both legs), close table of spec § 3; if one direction's write meets a leg already closing it waits for the other direction's close, so a daemon close reaches the page as its code. `open` refuses a daemon socket whose message cap exceeds the limit (`proxy_failed`).
- **Log.** `net` has no `log`: the app hands the set a `Fn(&str)`; lines are fixed texts, never the token, the URL or anything a peer sent.
- **Errors.** `ErrorCode` gained `Limit` and `ProxyFailed`; new `ProxyError`.
- **P16.** `codec.rs`, `window.rs`, `order.rs` moved to `apps/ipc-bench` with the channel-only constants (`apps/ipc-bench/src/limits.rs`); `net::limits` keeps `MAX_MESSAGE_BYTES` and the proxy's limits; `Rng` copied (the proxy tests use it).
- **P14.** `apps/ipc-bench/page/compare.js` judges B4 memory against the baseline's growth in the same run plus 64 MiB; a run without a baseline growth number fails that row; tested at the boundary, 1 KiB over, a small baseline, a missing baseline. No benchmark was run.
- **Layer check.** `net` (layer 7) could depend on `tauri`: `UI_MIN_LAYER = 6` allowed every layer ≥ 6. Replaced by `UI_LAYER = 6` in `desktop/xtask/src/layers.rs` (violation `UiOutsideUiLayer`); a test shows `net` on `tauri` or `wry` is flagged while `shell` and an app binary are not.
- **Dependencies.** `net` now uses `futures-util` and `getrandom` and more `tokio` features; no new crate, licences unchanged (tokio MIT; futures-util, getrandom MIT OR Apache-2.0).

## Files changed
`desktop/crates/net/src/proxy/**` (new), `error.rs`, `lib.rs`, `limits.rs`, `testing.rs`, `Cargo.toml`; `desktop/apps/ipc-bench/src/{bridge,main}.rs` and the moved `codec.rs`, `limits.rs`, `order.rs`, `testing.rs`, `window.rs`, `page/compare.js` + test; `desktop/xtask/src/layers.rs`; `desktop/Cargo.lock`; docs: `desktop/docs/architecture.md`, `desktop/docs/development.md`, `desktop/AGENTS.md`, `desktop/README.md` (a `net` row it lacked).

## Commands run
- `cargo test -p pistudiodesktop-net -p pistudiodesktop-ipc-bench`: net 83 passed, ipc-bench 90 passed. Clippy `-D warnings` and `cargo fmt` on net, ipc-bench, xtask: clean. `cargo xtask layers`: ok. wasm32 check: passes (`net` empty there). `node --test 'apps/ipc-bench/page/*.test.mjs'`: 71 pass. 24 extra runs of the net tests (one CPU, three at once): all green.
- Wave gate (orchestrator): `cargo xtask ci` in `desktop/`: all 8 steps passed (562 tests in the workspace run). The root npm gates were not re-run: no file under `packages/` changed since the sprint's first wave, where they passed (4,133 tests).

## Acceptance criteria
- [x] Echo of text and binary unchanged; 100,000 mixed messages in order with equal digests both ways (two independent seeded streams at once).
- [x] Wrong token, origin, host, a second use: each a 403 (eight wrong guesses, then the right client gets in; a failed claim is given back); after the upgrade the port refuses connections; the 16-upgrade limit, a non-upgrade request and no-subprotocol also tested.
- [x] No page in time: the daemon's leg sees 1001, the snapshot is empty, `lastError` `page_timeout`, port closed.
- [x] A client that does not read stalls a 128 MiB flood; peak at or under 256 KiB plus one 64 KiB message; reading again delivers all 2,048 frames in order.
- [x] Closes with code and reason both ways; a reset daemon ends the page with no close frame; a vanished page gives the daemon 1001; 1009 on both legs at a lowered cap and at the shipped one (1 byte over 128 MiB); unanswered close dropped after the wait; invalid UTF-8 from each side; a frame cut in the middle.
- [x] A fifth connection is `limit`; `close_all` leaves none and each daemon saw 1001 (two open, two waiting; also with a stalled flood).
- [x] Marker test: the token and the local address are in no error, log line, snapshot or `Debug` output.
- [x] The benchmark builds and its tests pass; `cargo xtask ci` passes including layers and wasm.

## Follow-ups / TODO(verify)
- Not tested: a failed bind or random read (`proxy_failed` cannot be induced), a half-open TCP socket; keepalive on the daemon's leg is task-001's.
- The closer is answered by the library's echo, not by the other leg's own answer (spec TODO(verify), still open against the SDK's close handling).
- **Choices of the implementer for the owner to accept or change:** `lastError` when no page gets in time is `page_refused` if the gate refused at least one attempt, else `page_timeout`; `page_refused` is also recorded when the page's leg breaks the protocol after getting in; a page that leaves records nothing. A fifth code is an option. Written into spec § 7.
- `close_all()` returns when the started connections are gone, which costs up to the 2 s close wait per unresponsive daemon (all wait in parallel); a reservation still dialling is closed as it opens.
- Spec edits made by the orchestrator: § 7 (`peakHeldIn`/`peakHeldOut`, `lastError` rules), the pseudocode (reserve before the dial, open after), three TODO(verify) items.
