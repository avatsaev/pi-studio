# Task 002 — Network change detection

- **Sprint:** sprint-114-desktop-resume-signals
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The app notices that the machine's network addresses changed and tells the page once.

## Context / why
P8. Moving between networks leaves a socket that will only fail after a timeout. Polling the interface addresses is portable and needs no notification API.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 6 (the `network` row), § TODO(verify) ("The interface-address crate")
- `desktop/crates/shell/src/` (the module of task-001)
- `desktop/apps/pistudiodesktop/src-tauri/src/`
- `desktop/AGENTS.md` rule 9

## What to build
- A pure part in the shell crate: given the set of non-loopback addresses at each reading, it answers when the set changed, at least one address remains, and 1 s passed without another change.
- In the app binary: read the addresses every 5 s and emit `connection_resume` with `{ reason: "network" }` through the rate limiter of task-001; count it in `resumeSignals.network`.
- Choose how the addresses are read: `if-addrs` 0.15.0 is the candidate (MIT OR BSD-3-Clause on crates.io; read it before adding). Record the choice, the licence and the cost of one reading.

## Out of scope
- Reachability of any host.
- Operating-system change notifications.

## Acceptance criteria
- [ ] With injected readings: an added address, a removed one and a replaced one each signal once after 1 s of quiet; losing every address does not; a change during the quiet second restarts it.
- [ ] A reading that fails is skipped and logged once, not every 5 s.
- [ ] The summary gives the measured time of one reading on Linux.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo xtask ci` in `desktop/`

## Notes
- Addresses are not secrets, but do not log them: log that the set changed and how many there are.
