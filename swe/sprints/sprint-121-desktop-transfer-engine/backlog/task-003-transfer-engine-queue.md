# Task 003 — The engine: the queue, three at once, the connection on demand, progress and the snapshot (D6, D7)

- **Sprint:** sprint-121-desktop-transfer-engine
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/transfer/src
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-001, task-002

## Goal
One object takes uploads and saves, runs at most three, opens the connection when needed and closes it when idle, and says what it is doing.

## Context / why
The app binary must only translate commands into calls. Everything about order, limits and the connection's life is here, testable with the stand-in.

## Scope references
- `swe/features/desktop-transfer-engine.md` § The queue (pseudocode), § 2 (`id`, the event), § 3 (Close), § 8 (the `transfers` shape), decisions D6, D7, S3, S5

## What to build
- Calls: start an upload (`id`, daemon path, a source), start a save (`id`, daemon path, a sink), cancel one, cancel all and close, and a snapshot. A start resolves when the transfer has settled, with the bytes or an error code and message.
- The connection is obtained through something the caller supplies ("give me an open socket to the current daemon, or an error and whether a retry can help"), so the crate knows nothing of the registry or the secret store.
- At most three transfers are active; the rest wait in order. The connection opens when the first becomes active; 30 s after nothing is active or waiting it is closed with 1000. A new transfer stops that timer.
- `id`: 1 to 64 characters of `A-Z a-z 0-9 -`, else `invalid_request`; an id that is active or waiting is `duplicate_id`.
- Events to a callback the caller supplies: `{ id, state: queued | running | waiting, done, total }` at every change of state and at most 10 times a second per transfer while bytes move; none at settlement.
- The snapshot: the connection's state and how often it was opened, the active transfers (id, kind, state, bytes done and total, restarts), the count waiting, totals of done, failed and cancelled, the most bytes held at one moment, and the last error with its time. No path.

## Out of scope
- Reconnecting (task-004): in this task a connection that cannot open or that drops fails the transfers.
- The Tauri commands (sprint 122).

## Acceptance criteria
- [ ] Four transfers started together: three run, the fourth is `queued` and starts when one settles; they settle in an order consistent with their sizes.
- [ ] With a paused clock: the connection closes 30 s after the last transfer, and a transfer started at 29 s keeps it open.
- [ ] A transfer emits at most 10 progress events a second and one event per change of state.
- [ ] Cancel of a queued transfer, of an active one, and cancel-all each settle the right transfers as `cancelled` and leave the snapshot's totals right.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: no unwrap, expect or panic outside tests, no unsafe; every size is checked before it is used.
- The most-bytes-held counter is what the 5 GiB check reads (`transfers.peakHeld`): count the read buffer of each upload and the unwritten bytes of each download.
