# Task 001 — Linux acceptance run and the platform checklist

- **Sprint:** sprint-106-desktop-native-host-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop (app in the WebDriver container), desktop/docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-104/task-008, sprint-105/task-005

## Goal
Every acceptance criterion of the native-host spec has a recorded result on Linux, and a person with a Mac or a Windows machine has a checklist they can run in under an hour.

## Context / why
The earlier sprints checked their own pieces. This is one pass over the whole spec on the final code. The spec also says plainly that nothing has run on macOS or Windows; that can only be closed by a person at those machines, and they need exact steps.

## Scope references
- `swe/features/desktop-native-host.md` § Acceptance criteria (all), § TODO(verify) (all)
- The summaries of sprint-103/task-004, sprint-104/task-008 and sprint-105/task-005 (evidence to cite, not to repeat blindly)
- `swe/notes/desktop-preview-origin-spike.md` (the probe procedure)
- `desktop/docs/development.md`, `.github/workflows/desktop-release.yml` (a manual run builds installers as artifacts)

## What to build
- **Linux pass.** Go through the spec's acceptance list on the built app. Re-run what later work could have broken; cite an earlier summary where nothing changed since. Add the one check no earlier task made: the copy action puts the text on the system clipboard (spec TODO: clipboard in the webview).
- **`desktop/docs/platform-checks.md`.** A checklist for macOS and Windows; each item has steps and the expected result:
  - the app starts, connects to a daemon by address, and restores its layout after a restart; where the configuration directory is and which files appear;
  - copy, paste, select-all and quit shortcuts;
  - the upload button opens the operating system's file picker;
  - a file dragged from the file manager onto the explorer uploads;
  - a confirm and an alert are native and modal;
  - "Download" on a large file: save dialog, correct file, cancel leaves nothing;
  - an `https` link opens the default browser and the window stays;
  - a second launch focuses the first window;
  - closing during a transfer asks first;
  - a layout change made just before closing survives (the `pagehide` question);
  - the preview probe from the spike notes, with how to read its result (`origin` or `inert`).
  It ends with a results table (date, OS version, pass or fail per item).

## Out of scope
- Running the checklist on macOS or Windows (task-002).
- New features or fixes beyond what a failed Linux check requires.

## Acceptance criteria
- [ ] Each acceptance criterion of the spec has "pass", "fail" or "not applicable on Linux" with its evidence in the summary.
- [ ] The clipboard check has a recorded result.
- [ ] `desktop/docs/platform-checks.md` exists, covers every item above, and each item names its expected result.
- [ ] Any failure is reported in the summary with a proposed fix; the task is not marked done over a failing criterion.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- The WebDriver container for the app; the X display's clipboard read with a command-line tool in the check image.
- `cargo xtask ci` in `desktop/`.

## Notes
- Run in the orchestrator.
