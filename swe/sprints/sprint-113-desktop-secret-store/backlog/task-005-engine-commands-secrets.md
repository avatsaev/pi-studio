# Task 005 — Engine commands: add, update and remove entries with their secrets in the store

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/engine
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
`daemon.add`, `daemon.update` and `daemon.remove` keep their contracts while the secret goes to the store and never to the registry file.

## Context / why
The page sends a typed password or pairing link to Rust in these commands and never gets it back. A secret that cannot be stored must fail the command before anything is written, so the registry never claims a password it does not have.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 5 (the paragraph on engine commands), § Error handling
- `swe/features/desktop-daemon-registry.md` § Public contract 2, § Adding, editing, removing (D22, D23)
- `desktop/crates/engine/src/daemon_cmds.rs`, `error.rs`

## What to build
- Add and update: store the given secret first; on failure answer `secret_store_failed` and write nothing. Then write the registry with `hasPassword` set.
- Update that clears a password deletes the item and clears `hasPassword`. A relay entry's replaced link (D23) overwrites its item.
- Remove: delete both kinds for the entry, then remove it. A delete that fails is logged with the entry id only and reported as a notice; the entry is removed all the same.
- The answers are the same views as before.

## Out of scope
- The Daemons screen (task-007).
- Backend choice (task-006).

## Acceptance criteria
- [ ] After each of add, update and remove with marker secrets, `daemons.json` contains no marker and the store holds exactly the expected items.
- [ ] With a failing store, add and update answer `secret_store_failed` and the file is unchanged.
- [ ] With a store whose delete fails, remove succeeds, a notice is returned once and the log line has the entry id and no secret.
- [ ] Clearing a password removes the item and `hasPassword` becomes false in the view.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-engine`
- `cargo xtask ci` in `desktop/`

## Notes
- The commands are also reachable from the control socket and the app's CLI: the blocking rule decided in task-004 applies to every caller.
