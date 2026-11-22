# Task 001 — Engine: the relay plan without the link, and `secret_guard` — Summary

- **Sprint:** sprint-126-desktop-relay-wiring
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `engine::relay_address(link)`: `ws(s)://<relay host>`, or `ws://<host>` for a host hint, derived from the parsed link; `daemon_resolve_current` answers it for a relay entry; an unparsable held link is `invalid_link`.
- `BridgePlan` gained `kind`; for relay, `read_password` reads the link from the store's pairing-link slot; with the link in the store `url` is empty and the caller derives it from the link it reads (task 126/t002 must account for this).
- `plan_bridge` no longer refuses relay; `not_bridged` is removed from `static_code`.
- `secret_guard` has a canary that fails when an answer holds the link and asserts the relay answer is the relay address.

## Files changed
`crates/engine/src/{local.rs,lib.rs,secret/tests.rs}`, `crates/shell/src/{daemons.rs,owner_access.rs}`, `crates/shell/tests/secret_guard.rs`, `apps/pistudiodesktop/src-tauri/src/commands.rs`, `commands/tests.rs`, `commands/tests/transport_tests.rs`

## Build & test results
```
cargo test -p engine -p shell -> passed (66 / 211 + secret_guard)
cd desktop && cargo xtask ci -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria
- [x] Engine tests for the relay plan with the link held and stored.
- [x] `secret_guard` fails if `daemon_resolve_current` returns the link.

## Follow-ups
- `transport.rs` (`plan_failure`'s `not_bridged`), `transfers/engine.rs` (a `not_bridged` test), `FINAL_CODES` and the docs still mention the dead code: 126/t002 and 130/t002.
