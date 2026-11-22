# Task 002 — Automated platform checks on the macOS and Windows runners for milestone 3 (D17)

- **Sprint:** sprint-123-desktop-transfer-engine-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop/apps/pistudiodesktop/scripts/platform-checks, .github/workflows
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The runner workflow shows, on macOS and Windows, that the engine builds, starts, reports its view, and moves a file where that can be done without a person.

## Context / why
D17: the automated suites on the runners. Windows has no daemon, and macOS has no WebDriver.

## Scope references
- `swe/features/desktop-transfer-engine.md` § Acceptance criteria (Tests and machines), § TODO(verify) (the runner scripts; the open dialog)
- `desktop/apps/pistudiodesktop/scripts/platform-checks/` (`bridge.mjs`, `stand-in-daemon.mjs`, `control-client.mjs`, `report.mjs`), `.github/workflows/desktop-platform-checks.yml`, `desktop-ci.yml`
- `desktop/docs/platform-checks.md` (§ The automated workflow)

## What to build
- The Rust tests of the `transfer` crate and of the app's commands run on both runners (confirm that `desktop-ci.yml` runs them there; add them if it does not).
- The runner scripts read `ui.inspect`'s `transfers` (mode `engine`; `page` with the option).
- Find out whether a transfer can be started through the page without a native dialog on each runner (WebDriver on Windows; none on macOS). If it can, add the check with the stand-in daemon extended for file transfer; if it cannot, say so in `platform-checks.md` and leave the step manual.
- The results go into `platform-checks.md`.

## Out of scope
- A control method that starts a transfer by path: not specified (it would let the control socket name local files).

## Acceptance criteria
- [ ] One workflow run is green on both runners, with its number recorded.
- [ ] `platform-checks.md` says, per step of the milestone 3 section, automated or manual, and why.
- [ ] The scripts' own tests pass on Linux.

## Test / verification plan
- `node --test desktop/apps/pistudiodesktop/scripts/platform-checks/*.test.mjs`
- A run of `desktop-platform-checks.yml` on the pushed branch

## Notes
- Pushing the branch and opening a pull request need the owner's word.
