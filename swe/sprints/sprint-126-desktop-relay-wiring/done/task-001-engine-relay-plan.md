# Task 001 — Engine: the relay plan without the link, and `secret_guard`

- **Sprint:** sprint-126-desktop-relay-wiring
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/engine, desktop/apps/pistudiodesktop/src-tauri/tests/secret_guard.rs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-124/task-003

## Goal
For a relay entry the engine answers the relay's address (S3) to the page and gives the app a plan it can dial; no command returns the link.

## Context / why
D5, S3. Today `plan_dial` answers the link as `url` and `plan_bridge` answers `not_bridged`.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 3, § Opening a connection, D5, S3
- `desktop/crates/engine/src/local.rs` (`plan_dial`, `plan_bridge`, `BridgePlan`)
- `desktop/apps/pistudiodesktop/src-tauri/src/commands.rs` (`daemon_resolve_current`)
- `desktop/apps/pistudiodesktop/src-tauri/tests/secret_guard.rs`

## What to build
- `BridgePlan` carries what each kind needs: for relay, the entry and that its link is read from the store; `plan_bridge` no longer refuses relay; `not_bridged` is removed.
- `daemon_resolve_current` answers `ws(s)://<relay host>` or `ws://<host>` (a host hint), derived from the parsed link, never the link.
- `secret_guard` asserts no command answer holds a stored link.

## Out of scope
- Dialling (t002).

## Acceptance criteria
- [ ] Engine tests for the relay plan, with the link held and stored.
- [ ] `secret_guard` fails if `daemon_resolve_current` returns the link.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

