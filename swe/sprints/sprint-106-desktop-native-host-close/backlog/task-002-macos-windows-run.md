# Task 002 — macOS and Windows: run the platform checklist

- **Sprint:** sprint-106-desktop-native-host-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop (installers on real machines)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The platform checklist has a filled-in result for macOS and for Windows, and each platform's HTML preview kind is set from a measurement.

## Context / why
The development machine is Linux. No part of the desktop app has ever run on macOS or Windows; the installers were first built by pull request #57. **This task needs a person with those machines.** An implementer working only on Linux cannot complete it and moves it to `blocked/` with that reason.

## Scope references
- `desktop/docs/platform-checks.md` (task-001)
- `swe/notes/desktop-preview-origin-spike.md` (the probe)
- `.github/workflows/desktop-release.yml` (manual run: installers as workflow artifacts, no release)
- `swe/features/desktop-native-host.md` § TODO(verify) ("macOS and Windows", and every entry that names the three webviews)
- The platform table for the preview kind in the app's Rust code (sprint-105/task-003)

## What to build
1. The engineer starts a manual run of the Desktop release workflow on the branch and downloads the macOS and Windows artifacts. (Starting a workflow is the engineer's decision, not the implementer's.)
2. Install each, run every item of the checklist, fill in the results table.
3. For each platform where the preview probe shows scripts running and every isolation attempt failing: change that platform to `origin` in the platform table and add its URL form to `frame-src` if it differs. Otherwise it stays `inert`.
4. For each failed item: a short entry in the task summary (what happened, what was expected) and, where the fix is small and certain, the fix with its test. Anything larger is reported for planning, not fixed here.

## Out of scope
- Signing, notarisation and the gatekeeper warnings (milestone 5): the installers are unsigned, and the checklist says how to open them anyway.
- A local daemon on Windows.

## Acceptance criteria
- [ ] The results table in `desktop/docs/platform-checks.md` has a dated row for macOS and one for Windows, with the OS version.
- [ ] The preview kind of each platform matches its probe result, and the documents' per-platform table says which platforms were measured.
- [ ] Every failed item is recorded with what was seen.
- [ ] If code changed: `cargo xtask ci` passes and the Desktop CI run for the commit is green.

## Test / verification plan
- The checklist itself, on the two machines.
- `cargo xtask ci` in `desktop/` after any code change.

## Notes
- Not a dependency of task-003: the spec can be closed for Linux with the macOS and Windows criteria left open and pointing here.
- macOS runs unsigned downloads only after the user allows the app in System Settings; Windows shows a SmartScreen warning.
