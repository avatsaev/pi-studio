# Task 004 — `net`: `DaemonSocket`, `dial_over`, and the proxy and the engine over it

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Status:** done
- **Type:** refactor
- **Area:** desktop/crates/net, desktop/crates/transfer, desktop/apps/pistudiodesktop/src-tauri (callers)
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-001

## Goal
The proxy and the transfer engine take any daemon socket that is a stream and sink of WebSocket messages, and a WebSocket can be opened over a stream the caller supplies.

## Context / why
D2 and S2: a relay channel carries messages, not bytes, and an SSH channel is a byte stream the caller opens. Today `Socket = WebSocketStream<Stream>` is fixed in `Reservation::open`, the proxy's task and `Connector::connect`.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 6, D2, S2
- `desktop/crates/net/src/dial.rs`, `stream.rs`, `proxy/mod.rs`, `proxy/run.rs`, `proxy/pump.rs`, `proxy/close.rs`
- `desktop/crates/transfer/src/engine/connector.rs`, `connection.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs`, `transfers/engine.rs`

## What to build
- `DaemonSocket`: a boxed `Stream<Item = Result<Message, _>> + Sink<Message> + Send + Unpin` with `max_message_bytes()`; a WebSocket over any `AsyncRead + AsyncWrite + Send + Unpin + 'static` stream becomes one.
- `dial` answers a `DaemonSocket`; `dial_over(stream, url, password, limit, max)` runs the same request (Host from `url`, bearer subprotocol) and the same error mapping on the supplied stream.
- The proxy's task, pump, close table and `Reservation::open` take `DaemonSocket`; the message-limit check reads `max_message_bytes()`.
- `Connector::connect` returns `DaemonSocket`; `Connection::open` takes it.
- The app's two callers compile unchanged in behaviour.

## Out of scope
- Relay or SSH code.

## Acceptance criteria
- [ ] Every existing `net`, `transfer` and app test passes unchanged in what it asserts.
- [ ] A new test: `dial_over` on a `tokio::io::duplex` pair upgrades against a stand-in daemon and the proxy pumps through it in order.
- [ ] `peakHeld` tests of the proxy still hold.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes
- Keep one place for the close-code table; do not fork the pump.
