# Task 003 — Relay crate: the open channel as a `DaemonSocket` — Summary

- **Sprint:** sprint-125-desktop-relay-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `Connected::into_socket()` returns a `DaemonSocket`: text and binary messages sealed with kind `0x01`/`0x02`, one frame each; received frames opened and delivered by kind; a frame that does not open (or a text frame) delivers nothing, closes 4200 towards the relay and hands the proxy a 4200 close; the relay's close code and reason pass through; pings left to the WebSocket library.
- `MAX_SEALED_BYTES` (100 MiB), `SEAL_OVERHEAD` (17), `plain_limit`, `sealed_limit`; `max_message_bytes()` is the caller's limit capped so the sealed frame stays within 100 MiB; `connect` dials with the sealed limit.
- In `net`: `DaemonSocket::from_wire(wire, max_message_bytes)` (approved; the only net change).
- Stand-in relay accepts unlimited message sizes now (it dropped the 64 MiB frame itself).

## Files changed
`crates/relay/src/{socket.rs,socket/tests.rs,connect.rs,testing.rs,lib.rs}`, `crates/net/src/socket.rs`

## Build & test results
```
cargo test -p pistudiodesktop-relay -> 60 passed
clippy (also --features testing) clean; cargo check --target wasm32-unknown-unknown ok
```

## Acceptance criteria
- [x] 10,000 mixed messages arrive in order and intact through the proxy.
- [x] A 64 MiB message passes; `peakHeld` at most 64 MiB plus the proxy's flush batch.
- [x] A tampered frame closes 4200 on both legs; a relay close 4108 reaches the page as 4108.

## Follow-ups
- `from_wire` has no net unit test of its own (the relay tests exercise it).
