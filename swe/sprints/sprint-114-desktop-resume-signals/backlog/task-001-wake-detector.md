# Task 001 — Wake detection and the `connection_resume` event

- **Sprint:** sprint-114-desktop-resume-signals
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-113/task-006

## Goal
The app notices that the machine was asleep and tells the page once.

## Context / why
P8. After a sleep the socket is often dead while nothing has told the page. The workbench already knows what to do with a resume signal (a 5 s ping, then reconnect); it only needs the signal. Detection is a clock gap: no operating-system API and no `unsafe`.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 6 (the `wake` row, the rate limit), § 4 (the event), § 7 (`resumeSignals`), decision P8
- `packages/workbench/src/lib/connection/resume-handler.ts` (what the page does with a signal; unchanged)
- `desktop/crates/shell/src/` (a new pure module), `control.rs` (`view`)
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs`, `bridge.rs` (how the app emits `daemons_changed`)

## What to build
- A pure detector in the shell crate: given the wall clock and a steady clock at each tick, it answers whether 10 s or more passed that the 2 s tick does not account for. A wall clock that went backwards is not a wake.
- A rate limiter shared by every resume reason: at most one signal per 5 s.
- In the app binary: a thread that ticks every 2 s, runs the detector and emits `connection_resume` with `{ reason: "wake" }` to the page.
- `ui.inspect` gains `connection.resumeSignals: { wake, network }` (counts since launch; `network` stays 0 until task-002).

## Out of scope
- Network changes (task-002).
- The page's listener (task-003).
- Closing or probing any socket from Rust.

## Acceptance criteria
- [ ] With injected clocks: a 10 s gap signals once; 9 s does not; a backward wall clock does not; two gaps within 5 s give one signal.
- [ ] In the container, stopping the app's processes for 15 s and continuing them raises `resumeSignals.wake` by one.
- [ ] The ticker stops when the app exits and never panics.
- [ ] `cargo xtask ci` passes, including the wasm step for the shell crate.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo xtask ci` in `desktop/`

## Notes
- The shell crate builds for wasm32: no `log::` call and no clock read in the pure module; the app passes the times in.
- A debugger pause or a clock set forward also signals. That is harmless: the page probes and finds the connection alive.
