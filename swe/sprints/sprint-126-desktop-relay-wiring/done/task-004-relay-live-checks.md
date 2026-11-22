# Task 004 — Linux live checks of a relay entry in the real webview

- **Sprint:** sprint-126-desktop-relay-wiring
- **Status:** done
- **Type:** test
- **Area:** desktop/docs/platform-checks.md, desktop/docs/development.md
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal
Every relay criterion of the spec is seen in the real webview on Linux with a relay and a daemon started from the repository.

## Context / why
D20; `desktop/docs/development.md` § The transport proxy in the real webview (run 4) has the relay recipe, whose observation inverts now.

## Scope references
- `swe/features/desktop-relay-ssh.md` § Acceptance criteria (Relay, in the real webview; Transfers and recovery for relay)
- `desktop/docs/development.md` (Docker image, WebKitWebDriver, `ui.inspect`)
- `desktop/apps/pistudiodesktop/scripts/platform-checks/`

## What to build
- Run: connect, chat, terminal, `via: "relay"`; grep the answers and the log for the link and the relay host; a wrong-key link; the daemon stopped and started; a host-hint link; a 1 GiB upload and save with hashes; `kill -STOP`/`-CONT` for 90 s and a network cut during a transfer.
- Record the results in `platform-checks.md` § Milestone 4 and the recipe in `development.md`.

## Out of scope
- The 4 GiB memory comparison (sprint 130).

## Acceptance criteria
- [ ] Each relay criterion is ticked in the summary with the evidence; any failure is fixed in this task or recorded as a blocker.

## Test / verification plan
- The live run; `cargo xtask ci`

## Notes

