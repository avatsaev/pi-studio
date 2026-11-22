# Task 002 — App binary: `transport_open` and the engine's connector dial a relay entry — Summary

- **Sprint:** sprint-126-desktop-relay-wiring
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- A shared `Route` in `transport.rs` serves `transport_open` and the engine's connector: relay entry reads the link on the blocking pool, parses it, `relay::connect(...).into_socket()`; a link with a host hint is dialled with `net::dial` and no password; local and direct unchanged. With the link in the store the plan's `url` is empty and the address is derived from the link it reads, then `address_mismatch` is checked before a place is reserved.
- The relay's reasons pass through as codes with messages; `invalid_link`; `secret_missing` names the pairing link; `not_bridged` removed. An address with user info is `invalid_address` (final).
- The app's `RETRIED` and the transfer crate's `FINAL_CODES` (21 codes, incl. the SSH ones) follow the spec's table.
- `Route::resolve` answers `Kind::Ssh` with `unsupported` until 128/t004. `services.rs` has a stopgap `remote_run: None` for 128/t004 to replace.

## Files changed
`apps/pistudiodesktop/src-tauri/{Cargo.toml,src/transport.rs,src/transfers/engine.rs,src/commands.rs,src/commands/tests.rs,src/commands/tests/transport_tests.rs,src/commands/tests/relay_tests.rs,src/services.rs}`, `crates/transfer/src/engine/connector.rs`

## Build & test results
```
cargo test -p pistudiodesktop -p transfer -p relay -> 129 / 366 / 60 passed; clippy and layers clean
cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] `transport_open` for a relay entry answers a `localUrl` and the pump carries sealed text and binary messages (stand-in relay); the page's close arrives as 4000; no link, note or key in an answer or log line.
- [x] A wrong key answers `wrong_key`; the relay sees close 4200; the proxy place is given back.
- [x] The engine retries `daemon_offline` and fails at once on `wrong_key` (removing `daemon_offline` from `RETRIED` fails the test).

## Follow-ups
- Docs still mentioning `not_bridged`: desktop/AGENTS.md:70, docs/architecture.md (38, 154, 280), control-protocol.md:88 -> 130/t002.
