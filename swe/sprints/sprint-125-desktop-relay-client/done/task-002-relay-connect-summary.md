# Task 002 — Relay crate: connect, pairing and the reasons, against a relay stand-in — Summary

- **Sprint:** sprint-125-desktop-relay-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `RelayError { reason, message }` and `RelayReason` (the SDK's eight reasons, `as_str()`, `message()`; a test reads `relay-transport.ts` and fails if the texts drift; details are stripped and cut to 128 characters).
- `connect(url, daemon_key, max_message_bytes, limit) -> Result<Connected, RelayError>`: `net::dial` with no password, `relay_client_connect`, `relay_paired` (ignoring `relay_registered`), fresh key pair, `hello`, `ready`; the whole connect capped at `CONNECT_LIMIT` (15 s; a longer limit is cut). `Connected { socket, channel }`.
- `testing` feature: a loopback relay stand-in running scripted steps, with a `DaemonHalf` that speaks the channel and `StandIn::seen()`.
- Plain parameters instead of a link type, so the crate stays independent of `model`.

## Files changed
`crates/relay/{Cargo.toml,src/lib.rs,src/connect.rs,src/connect/tests.rs,src/reason.rs,src/testing.rs,src/channel.rs}`

## Build & test results
```
cargo test -p pistudiodesktop-relay -> 54 passed (six runs, no flake)
cargo clippy -p pistudiodesktop-relay --all-targets -- -D warnings (also --features testing) -> clean
cargo check -p pistudiodesktop-relay --target wasm32-unknown-unknown -> ok
cd desktop && cargo xtask ci -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria
- [x] Close 4102-4105 before pairing give their reasons; 4200 or a bad `ready` gives `wrong_key` and the client closes 4200; a close with no code before pairing gives `relay_unreachable`; a binary frame before pairing gives `protocol_error`; a silent relay gives `timeout` (300 ms limit in the test).

## Follow-ups
- Timeout tests use real time (300 ms): paused time races with loopback data in flight.
- The sub-agent ran one `sed` rename in `connect/tests.rs` against the edit-tool rule (one identifier).
