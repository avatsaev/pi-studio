# Task 003 — `Saves`: the engine's sink, and one save per destination (S1, D15)

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell/src/saves.rs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
An open save can be handed to the engine, which writes, finishes or discards it; two saves cannot write to one destination.

## Context / why
S1: the engine reuses the save mechanism (the temporary file beside the destination, the journal, the cleanup at launch). Until now only the page wrote into a save, through `save_write`.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 2 (`transfer_save`), § 9, decisions S1, D9, D15 (two saves into one file), § Error handling (`destination_busy`, `unknown_handle`, `disk`)
- `desktop/crates/shell/src/saves.rs` (`begin`, `write`, `finish`, `discard`, `MAX_OPEN`, `MAX_WRITE_BYTES`, the journal), `saves/` tests

## What to build
- A call that claims an open save by its handle for the engine: afterwards the page's `save_write`, `save_finish` and `save_discard` with that handle answer as for an unknown handle, and the claimed save offers write, bytes written so far, finish (flush, rename over the destination) and discard (remove the temporary file).
- Claiming a save whose destination another claimed save is writing answers `destination_busy`, and the second save is discarded.
- A claimed save still counts against `MAX_OPEN`, is still in the journal, and is removed by the launch cleanup after a crash. Dropping it without finishing discards it.

## Out of scope
- The download (the `transfer` crate).
- Changing the page's save path.

## Acceptance criteria
- [ ] Claim, write in several pieces, finish: the destination holds the bytes, the temporary file is gone, the journal is empty.
- [ ] Claim, write, discard (and: claim, write, drop): no temporary file, the destination untouched if it existed.
- [ ] A second claim on the same destination is `destination_busy` and leaves no file; after the first finishes, a new save to it works.
- [ ] The page's three commands refuse a claimed handle.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo clippy -p pistudiodesktop-shell --all-targets -- -D warnings`
- `cargo xtask ci` in `desktop/`

## Notes
- `shell` cannot depend on `transfer` (layer 8): the sink trait is implemented in the app binary (task-005) over this API.
