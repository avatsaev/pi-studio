# Task 003 — Open-project screen & new-workspace screen

- **Sprint:** sprint-013-app-navigation-screens
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; sprint-015 (composer) for the new-workspace composer

## Goal
Implement the open-project ("home") screen as one component parameterized by an optional host (serving
both the global `/open-project` and per-host `/h/[serverId]/open-project` routes), and the new-workspace
creation screen. The cross-host Sessions/Schedules screens and the command center are task-005.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Route map (cross-host vs per-host tiers),
  § Open-project (host home), § New-workspace
- `clean-room-scope/features/projects-workspaces.md`, `clean-room-scope/features/worktrees.md`
- `clean-room-scope/features/composer-ui.md` § Create-agent preferences (new-agent defaults)

## What to build
- Open-project ("home"): borderless menu header, logo + tiles (Add a project / Import session / Setup
  providers / Pair device [local only]), community links; desktop opens the sidebar on mount; responsive
  tile sizing. One component, reused by both the global route (no fixed host — host chosen inside "Add a
  project") and the per-host route (`serverId` param, scoped to that host).
- New-workspace: reads its host via a `?serverId=` **query parameter** (plus optional
  `?dir,name,projectId,draftId`), not a path segment. The shared composer with a custom footer (project
  picker [worktree-capable only], ref picker [branch / GitHub PR, searchable + debounced], mode control,
  optional checkout-PR hint); new-agent defaults prefilled from the project's create-agent preferences;
  submit empty → create empty worktree + navigate; with text → ensure worktree + stage pending draft +
  navigate to a prepared draft tab; errors toast + inline; supports image drops.

## Out of scope
- Settings/projects/sidebar (task-004). Cross-host Sessions/Schedules + command center (task-005). The
  composer surface itself (sprint-015) — consume it here.

## Acceptance criteria
- [ ] Open-project shows the four tiles (Pair device only on local) and opens the sidebar on desktop, in
      both its global and per-host route forms.
- [ ] New-workspace resolves its host from `?serverId=` (not a path segment), creates a worktree (empty or
      with a first prompt), and navigates into it; pickers list the right projects/refs; new-agent
      defaults come from create-agent preferences.

## Test / verification plan
- Tests: open-project tile gating (global vs per-host); new-workspace query-param parsing + submit
  branching (empty vs prompt) with a mock client.

## Notes
- Depends on the composer landing in sprint-015; until then stub the composer footer integration.
