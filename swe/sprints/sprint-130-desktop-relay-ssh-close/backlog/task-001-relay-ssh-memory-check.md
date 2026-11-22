# Task 001 — Memory and rates for relay and SSH transfers, and the checklist

- **Sprint:** sprint-130-desktop-relay-ssh-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop/docs/platform-checks.md
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-126/task-004, sprint-129/task-005

## Goal
The transfer criterion is measured for both kinds: hashes, `peakHeld`, the Rust process's growth for 1 GiB against 4 GiB, and the rates.

## Context / why
D19: no speed mark, rates recorded. The SSH window and packet sizes are set from this measurement (spec TODO).

## Scope references
- `swe/features/desktop-relay-ssh.md` § Acceptance criteria (Transfers and recovery), D19, § TODO(verify) (window and packet size)

## What to build
- Runs of 1 GiB and 4 GiB each way through the relay and through SSH, with a terminal echo sampled; adjust russh's window and packet size if the rate is far below the relay's, and record before and after.
- `platform-checks.md` § Milestone 4 completed.

## Out of scope


## Acceptance criteria
- [ ] Hashes equal; `peakHeld` ≤ 1 MiB; the Rust process grows less than 32 MiB more for 4 GiB than for 1 GiB; rates recorded.

## Test / verification plan
- The live run

## Notes
- Needs about 20 GiB of free disk.
