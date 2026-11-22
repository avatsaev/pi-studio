# Task 001 — The 5 GiB check, the Linux acceptance run, and the checklist's milestone 3 section (D16)

- **Sprint:** sprint-123-desktop-transfer-engine-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop, docs
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** sprint-122/task-007

## Goal
The milestone's check is run with its pass marks, and the platform checklist says what a person must run on macOS and Windows.

## Context / why
D16 is what closes the milestone: a 5 GiB file both ways with flat memory, not slower than the page's path, and a terminal that stays responsive.

## Scope references
- `swe/features/desktop-transfer-engine.md` § Acceptance criteria (The check; all), decisions D16, D17, § TODO(verify)
- `desktop/docs/platform-checks.md` (the milestone 2 section: its table and results tables), `desktop/docs/development.md`
- `swe/notes/desktop-ipc-benchmark.md` (how the echo under load was measured, row B7)

## What to build
- On Linux over loopback in the real webview: a 5 GiB upload from the native picker and a 5 GiB save, each with the SHA-256 on both sides, `transfers.peakHeld`, the growth of the app's Rust process, of the web process and of the daemon, and the rate.
- The same two transfers with `--transfers page` on the same build and machine, for the rate.
- A terminal's echo (median and 99th percentile) with no transfer and during each transfer.
- How often the liveness limit and the 1 MiB hold were reached (S3).
- A table of the results against the marks in the summary, and the spec's criteria ticked or left open with the reason.
- `platform-checks.md` gains "Milestone 3: file transfers in Rust": the native open dialog, a large upload and save, a cancel, a sleep during a save, and a transfer that waits through a sleep, each with steps and the result to expect, marked automated or manual, with empty results rows per machine.

## Out of scope
- Changing a mark: a missed mark is reported to the owner, not adjusted.

## Acceptance criteria
- [ ] The four criteria of "The check" are each reported with their numbers and a pass or a miss.
- [ ] Every other criterion of the spec is ticked from sprint 122's run or re-run here.
- [ ] `cargo xtask ci` and the root gates pass.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- `npm run build && npm run typecheck && npm run lint && npm test` at the root

## Notes
- Needs about 20 GiB of free disk (the file, the daemon's copy, the saved copy, and the page-path runs).
- If the page's path cannot take a 5 GiB upload at all, that is a result: report where it failed and compare on the largest size both paths complete.
