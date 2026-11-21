# Task 005 — Benchmark: echo under load, a hidden window, worker timers (B7, B8) and memory

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** in_progress
- **Type:** feature
- **Area:** desktop/apps/ipc-bench
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
The benchmark also reports latency while a download runs, what happens while the window is hidden, and how much memory a download costs.

## Context / why
B8 decides P7 (whether reconnect timers can stay in a worker) and shows whether the inbound window bounds what Rust holds when the page stops consuming. B4's pass mark includes memory growth.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 1 (rows B4, B7, B8), decision P7, § TODO(verify) ("Whether the app's 2 s tick runs while macOS naps a hidden app")
- `packages/workbench/src/host/browser-worker-timers.ts` (the timers P7 keeps)
- `desktop/apps/ipc-bench/`

## What to build
- B7: row B1's echo running on the same connection while row B4's download runs; the 99th-percentile round trip, for the baseline and the chosen candidates.
- B8: 1,000 inbound frames per second for 30 s with the window hidden, once with `hide` and once minimised, then shown. Recorded: frames lost, the most bytes Rust held, the time to catch up after the window is shown, and the delay of a 500 ms timer in a worker and of one on the page while hidden.
- A 2 s tick on the Rust side during B8, with its largest gap recorded (the wake detector of sprint 114 uses such a tick).
- Memory for B4: the resident size of the application's processes sampled once a second where the platform allows it (Linux from `/proc`; elsewhere record how it was read, or that it was not).

## Out of scope
- Changing P7: the note reports; the owner decides.
- Closing the gate (task-007).

## Acceptance criteria
- [ ] `results.json` has rows B7 and B8 and the memory samples for B4, in the container.
- [ ] B8 reports no lost frame and held bytes within the window, or the run fails naming what was lost.
- [ ] The summary states the worker timer's worst delay while hidden on Linux.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- Full-scale run in the container; attach `results.json`.

## Notes
- Under Xvfb a hidden window may behave unlike a real desktop's: say so beside the Linux numbers; the runners and a real machine are the evidence for P7.
