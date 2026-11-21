# Task 001 — Linux acceptance run for milestone 2, and the checklist's new items

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop/docs, swe/features
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-116/task-005, sprint-114/task-004, sprint-113/task-008

## Goal
Every acceptance criterion of the spec is run once more on Linux with everything built, and the platform checklist gains the items a person must run.

## Context / why
The earlier live checks ran each part alone; the resume checks ran while the socket was still the webview's. This run is the whole feature together.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Acceptance criteria (all), § TODO(verify)
- `desktop/docs/platform-checks.md`

## What to build
- Run every criterion on Linux in the real webview; the resume checks again, now with the bridged socket (stop and continue with a daemon restart: connected within 10 s, no reload).
- `desktop/docs/platform-checks.md` gains a section for milestone 2: sleep the machine for five minutes with a session open and wake it; add, edit and remove an entry and look for the item in Keychain Access or Credential Manager; what an unsigned macOS build asks after an update; a note that a daemon behind an HTTP proxy is not reachable. Each with steps and the result to expect, and marked automated or manual.
- Each TODO(verify) of the spec that the run answers is answered there.

## Out of scope
- macOS and Windows runs (task-002, task-003).
- Fixing in place: a failure goes back to the task that owns the code.

## Acceptance criteria
- [ ] The summary has one line per criterion: passed with evidence, or not run with the reason.
- [ ] The checklist has the new section.
- [ ] `cargo xtask ci` and the root gates pass.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- `npm run build && npm run typecheck && npm run lint && npm test` at the repository root.

## Notes
- Spec status lines and `PLAN.md` are the orchestrator's to edit.
