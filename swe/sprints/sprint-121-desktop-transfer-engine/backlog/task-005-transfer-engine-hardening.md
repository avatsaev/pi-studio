# Task 005 — Hardening: a drop and a cancel at every stage, a hostile daemon, nothing leaks

- **Sprint:** sprint-121-desktop-transfer-engine
- **Status:** backlog
- **Type:** test
- **Area:** desktop/crates/transfer
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-004

## Goal
The engine is shown to survive every fault the stand-in can produce, at every stage of both transfers, without a panic, a hang or a leak of a path or a secret.

## Context / why
Golden rule 2 of the desktop workspace: never crash; input is hostile. The spec's criterion names "a drop at every stage, a cancel at every stage, and hostile frames".

## Scope references
- `swe/features/desktop-transfer-engine.md` § Acceptance criteria (Tests and machines), § Error handling & edge cases (the last row), decision D20
- `desktop/crates/engine/tests/panic_hunt.rs` and `desktop/crates/shell/tests/secret_guard.rs` (the precedents)

## What to build
- A table-driven test: for an upload and for a save, a connection drop and a cancel at each stage (before the request, before its answer, before `Begin`, in the middle, after `End` before the confirmation, while waiting to reconnect), each ending in the expected outcome with the stand-in's state right (nothing half-written kept, no stream id still reserved, the sink finished or discarded exactly once).
- A seeded soak: three transfers at once with random faults for a fixed number of rounds; every transfer settles, and what completed is byte-exact.
- Hostile frames from the stand-in (each of its faults): the connection ends with `protocol` or the transfer with its code; no panic, no growth of memory beyond the limits.
- A marker test: a password, a local path placed in a source and a sink, and a handle-like string appear in no error message, event or snapshot.
- Large counters: a transfer whose sizes pass 4 GiB (simulated by a source and a stand-in that count without storing) reports exact totals.

## Out of scope
- Real files and the real daemon (sprints 122 and 123).

## Acceptance criteria
- [ ] Every row of the table passes, and the table lists each stage named above for both directions.
- [ ] The soak passes 20 times in a row on one CPU.
- [ ] `cargo xtask ci` passes, including the wasm and layer steps.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`
- Run the crate's tests 20 times: `for i in $(seq 20); do cargo test -p pistudiodesktop-transfer -q || break; done`

## Notes
- A defect found here is fixed here, with the test that showed it.
