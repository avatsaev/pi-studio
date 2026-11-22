# Task 004 — Recovery: reconnect, wake, what is final and what is retried, resume and restart (D5, D12, S9)

- **Sprint:** sprint-121-desktop-transfer-engine
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/transfer/src
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-003

## Goal
A dropped or unreachable daemon makes transfers wait and then continue by themselves; an error that a retry cannot fix fails them at once.

## Context / why
D12: the engine retries until the user cancels. D5: a save continues where it stopped, an upload starts again.

## Scope references
- `swe/features/desktop-transfer-engine.md` § The connection and its recovery (pseudocode, the two lists of codes), decisions D5, D12, D13, S3, S9

## What to build
- When the connection cannot open or drops: every active transfer goes to `waiting` (one event each); the engine tries again after 1 s, doubling to 30 s, with no limit on attempts; a successful open resets the delay.
- A call that ends the wait at once (the app calls it on a wake, a network change, and when the page's own connection to the same daemon opened). When nothing is active or waiting any more, the engine stops trying.
- Final errors fail every active and waiting transfer with that code: `unauthorized`, `host_not_allowed`, `tls`, `invalid_address`, `secret_missing`, `secret_unavailable`, `not_bridged`, `no_current`, `unsupported`, `unsupported_daemon`, `protocol`. Everything else is retried, including `handshake`.
- After a reopen: a save sends `offset` = the bytes its sink has written and `ifUnchanged` from its first answer (`changed` fails it, D13); an upload starts from byte 0 with a new `transferId` and its progress goes back to 0. Each counts a restart.
- A cancel while waiting settles at once.

## Out of scope
- Emitting or hearing the app's signals (sprint 122).

## Acceptance criteria
- [ ] The stand-in closes after N bytes of a download: the save completes, the sink holds the exact file, the second request carried the right `offset` and `ifUnchanged`, and `restarts` is 1.
- [ ] The same for an upload: the daemon ends with one whole file, and (R3's rule in the stand-in) nothing from the first attempt.
- [ ] The stand-in refuses connections for a (paused) hour, then accepts: the transfers were `waiting`, the delays were 1, 2, 4 … 30, 30 s, and they complete; the wake call ends a 30 s wait at once.
- [ ] A 401 at a reopen fails every transfer with `unauthorized` and no further attempt is made; a 502 is retried.
- [ ] The file changes between the drop and the resume: `changed`, and the sink was discarded.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: no unwrap, expect or panic outside tests, no unsafe; every size is checked before it is used.
- A local daemon that is stopped or still starting is reported by the app's supplier as retryable: the engine does not know about local daemons.
