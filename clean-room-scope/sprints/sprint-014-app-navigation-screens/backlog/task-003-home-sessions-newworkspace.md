# Task 003 — Open-project, sessions & new-workspace screens

- **Sprint:** sprint-014-app-navigation-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-016 (composer) for the new-workspace composer

## Goal
Implement the per-host landing (open-project), the session-history screen, and the new-workspace creation
screen.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Open-project, § Sessions, § New-workspace
- `clean-room-scope/features/projects-workspaces.md`, `clean-room-scope/features/worktrees.md`

## What to build
- Open-project (host home): borderless menu header, logo + tiles (Add a project / Import session / Setup
  providers / Pair device [local only]), community links; desktop opens the sidebar on mount; responsive
  tile sizing.
- Sessions: agent/session history sorted by last-activity desc; loading/empty/populated states with
  pull-to-refresh + load-more (no spinner on background revalidation).
- New-workspace: the shared composer with a custom footer (project picker [worktree-capable only], ref
  picker [branch / GitHub PR, searchable + debounced], mode control, optional checkout-PR hint); submit
  empty → create empty worktree + navigate; with text → ensure worktree + stage pending draft + navigate
  to a prepared draft tab; errors toast + inline; supports image drops.

## Out of scope
- Settings/projects/sidebar (task-004). The composer surface itself (sprint-016) — consume it here.

## Acceptance criteria
- [ ] Open-project shows the four tiles (Pair device only on local) and opens the sidebar on desktop.
- [ ] Sessions shows loading/empty/populated with pull-to-refresh + load-more.
- [ ] New-workspace creates a worktree (empty or with a first prompt) and navigates into it; pickers list
      the right projects/refs.

## Test / verification plan
- Tests: open-project tile gating; sessions state transitions; new-workspace submit branching (empty vs
  prompt) with a mock client.

## Notes
- Depends on the composer landing in sprint-016; until then stub the composer footer integration.
