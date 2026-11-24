# Task 004 — Live check: the app updates an outdated local daemon and an SSH one

- **Sprint:** sprints/sprint-138-daemon-update-desktop
- **Status:** done
- **Type:** test
- **Area:** desktop (xvfb container)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, sprint-136/task-005

## Goal
In the real webview on Linux, Update brings an outdated local CLI and an SSH host's CLI to the new version and starts the daemon; and the workbench pill updates a running daemon from inside the app.

## Context / why
Spec § Acceptance criteria (Desktop). Uses the local registry of sprint-136/task-005 and the `pi-desktop-xvfb` recipes.

## Scope references
- `swe/features/self-update.md` § Acceptance criteria
- `desktop/docs/development.md` (a new section with the recipe), `desktop/docs/platform-checks.md` (rows D-U1…)
- `scripts/daemon-update-check/`

## What to build
- Local: a global install of an older version (below a minimum raised for the test build, or a real older version from the local registry) → Daemons screen shows Update → click → running on the new version.
- SSH: the same against an sshd container.
- Running daemon: the pill → dialog → update → the app reconnects through its proxy and shows the result.
- A failure (registry stopped) shows the output's last lines.

## Out of scope
macOS and Windows (no machine).

## Acceptance criteria
- [ ] Each row recorded with evidence; defects fixed in the owning files with tests.

## Test / verification plan
- `cd desktop && cargo xtask ci`; root `npm test`

## Notes
Clean worktree with its own `CARGO_TARGET_DIR`; containers with their own names; remove everything at the end.
