# Task 003 — A person: the native dialogs and a sleep during a transfer, on macOS and Windows

- **Sprint:** sprint-123-desktop-transfer-engine-close
- **Status:** backlog
- **Type:** test
- **Area:** desktop/docs
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The manual steps of the milestone 3 section are run on real machines and their results recorded.

## Context / why
The native open dialog has never been shown by this app; a runner cannot sleep; a command left pending through a sleep is unverified on WKWebView and WebView2.

## Scope references
- `swe/features/desktop-transfer-engine.md` § TODO(verify) (the open dialog; a command unanswered across a sleep), decision D17
- `desktop/docs/platform-checks.md` (the milestone 3 section written by task-001)

## What to build
- Each manual step of the section on a Mac and on a Windows machine, with the installer of the branch's workflow run: the results rows filled in.
- A defect found is fixed with a test, or recorded as an open row with what was seen.

## Out of scope
- Anything the runners already cover (task-002).

## Acceptance criteria
- [ ] The results rows of the milestone 3 section are filled for at least one machine per system, or the task is in `blocked/` with the reason.

## Test / verification plan
- The steps of `desktop/docs/platform-checks.md`, milestone 3

## Notes
- Expected to wait in `blocked/` for a person with the machines, as sprint-117/task-003 did. It does not hold task-004.
