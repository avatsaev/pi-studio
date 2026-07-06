# Task 003 — Open-project & new-workspace screens

- **Sprint:** sprint-019-navigation-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-018; sprint-013/task-003 (open-project/new-workspace models), sprint-015/task-006 (composer/provider prefs)

## Goal
Build the `/open-project` (global + per-host) and `/new` (new-workspace) screens — choosing a project/
directory, provider/model, worktree setup, and initial prompt to launch an agent workspace.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § open-project, § new-workspace
- `clean-room-scope/features/projects-workspaces.md`, `clean-room-scope/features/worktrees.md`

## What to build
- `/open-project`: project/directory picker (recent projects + browse), per-host scoping, validation of
  the execution directory; consume the sprint-013 open-project model.
- `/new` new-workspace: provider + model selection, worktree vs in-place toggle + branch/setup options,
  initial-context/prompt field, fork-from-existing option; launch → create agent + route to the
  workspace. Consume the sprint-013 new-workspace models + sprint-015 create-agent preferences.
- Provider/model selector component (combobox) + provider-usage hint where available.
- Loading/validation/error states; disabled-launch reasons surfaced.

## Out of scope
- The workspace shell/timeline (sprint-020/021). Settings projects (task-004).

## Acceptance criteria
- [ ] Open-project picks a project/dir (recent + browse), validates it, and proceeds per host.
- [ ] New-workspace selects provider/model + worktree options + initial context and launches, routing to
      the created workspace (mock client).
- [ ] Launch is gated with human-readable reasons when inputs are incomplete.

## Test / verification plan
- Tests: open-project picker state + validation; new-workspace form → create-agent request (reuse
  sprint-013/015 models); provider/model selection.

## Notes
- The initial-context field reuses the composer input primitive (sprint-021/task-004) where practical.
