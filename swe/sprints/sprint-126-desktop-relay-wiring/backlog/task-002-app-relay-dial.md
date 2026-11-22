# Task 002 — App binary: `transport_open` and the engine's connector dial a relay entry

- **Sprint:** sprint-126-desktop-relay-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri (transport.rs, transfers/engine.rs), desktop/crates/transfer (codes)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-125/task-003

## Goal
A relay entry is opened by Rust for the page and for transfers, with the new codes classed for retry.

## Context / why
§ Opening a connection and § What the engine retries.

## Scope references
- `swe/features/desktop-relay-ssh.md` § Opening a connection, § What the engine retries, § Error handling
- `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/transfers/engine.rs`
- `desktop/crates/transfer/src/engine/connector.rs` (`FINAL_CODES`)

## What to build
- Relay branch: read the link on the blocking pool, parse, `relay::connect` (or `net::dial` for a host hint), then the reservation as for direct.
- Failure codes and messages for the relay reasons; `FINAL_CODES` and the app's `RETRIED` per the spec's table.

## Out of scope


## Acceptance criteria
- [ ] App tests with the relay stand-in: `transport_open` for a relay entry answers a `localUrl` and the pump carries messages; a wrong key answers `wrong_key`; the engine retries `daemon_offline` and fails at once on `wrong_key`.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

