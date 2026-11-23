# Task 004 — `net`: `DaemonSocket`, `dial_over`, and the proxy and the engine over it — Summary

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `net/src/socket.rs`: `DaemonSocket` (boxed stream and sink of WebSocket messages with `max_message_bytes()`; `DaemonSocket::new` wraps a WebSocket over any stream) and a `Wire` trait whose `discard()` serves `refuse_oversize` on both legs.
- `dial` returns `DaemonSocket`; `dial_over(stream, url, password, limit, max)` runs the same request, limits and error mapping on a caller-supplied stream. The `Socket` alias is deleted.
- The proxy (pump, close table, task, `Reservation::open`) takes `DaemonSocket`; one close-code table, no forked pump.
- `transfer`: `Connection::open` takes `DaemonSocket`; the `Transport` trait is deleted; `Connector::connect` returns `DaemonSocket`.
- App: `transfers/engine.rs` only for the type name.

## Files changed
`crates/net/src/{socket.rs,dial.rs,lib.rs,stream.rs,proxy/*}`, `crates/transfer/src/**` (connector, connection, test helpers), `apps/pistudiodesktop/src-tauri/src/transfers/engine.rs`

## Build & test results
```
cargo test -p net -p transfer -p pistudiodesktop -> 87 / 366 / 113 passed (the app's two registry tests failed once while another agent edited registry fixtures, passed on rerun)
cd desktop && cargo xtask ci -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria
- [x] Existing tests pass with the same assertions.
- [x] `dial_over` on a duplex pair upgrades; the proxy pumps 50 mixed messages in order through it.
- [x] The proxy's `peakHeld` tests still hold.

## Follow-ups
- `desktop/AGENTS.md` and `docs/architecture.md` mention `Socket`/`Transport`: closed in sprint 130/t002.
