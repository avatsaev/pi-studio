# Task 001 — Relay crate: session id and the encrypted channel, against the fixtures — Summary

- **Sprint:** sprint-125-desktop-relay-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `session_id(daemon_key)`: hex of the first 16 bytes of SHA-512.
- `Channel` (`hello`, `accept_ready`, `seal`, `open`, `is_open`): nonce salt ‖ direction ‖ big-endian counter, counters to 2^64-1 then `CounterLimit`; any refused frame closes the channel for good. `KeyPair::generate()` from the OS random source, `from_secret` for tests; `Debug` hides the secret.
- Fixture test reads the relay `manifest.json`, accepts `formatVersion` 1 only, fails on an unlisted or missing file, derives `sessionId`, rebuilds `hello`, `ready` and both client frames byte for byte and opens both daemon frames. `sharedKey` is proved indirectly (the sealed frames match only with the same key; `crypto_box` hides it).
- Refusal tests: malformed ready, wrong key, tampered/dropped/replayed/reordered boxes, under 17 bytes, unknown kind, `0x00` after ready, non-UTF-8 text, wrong salt, counters at the limit.

## Files changed
`crates/relay/{Cargo.toml,src/lib.rs,src/channel.rs,src/channel/tests.rs,src/error.rs,src/session_id.rs}`

## Build & test results
```
cargo test -p pistudiodesktop-relay -> 28 passed
cargo clippy -p pistudiodesktop-relay --all-targets -- -D warnings -> clean
(the full gate runs at the end of the wave with sprint 125/126/128 tasks)
```

## Acceptance criteria
- [x] Fixture test as specified (sharedKey indirect).
- [x] Each refusal case has a test.

## Follow-ups
- The `EmptyRecord` branch in `open` is unreachable (the 17-byte minimum catches it first); kept as a no-panic guard.
