# Task 004 — Settings, projects & hosts screens

- **Sprint:** sprint-019-navigation-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-018; sprint-013/task-004 (settings IA, projects, sidebar models)

## Goal
Build the settings information architecture and its sections, plus the projects and per-host settings
screens.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § settings
- `clean-room-scope/features/localization.md`, `keyboard-shortcuts.md`, `provider-usage.md`,
  `desktop-app.md` (daemon-mode toggle)

## What to build
- `/settings` index + `/settings/:section` sections: Appearance (theme variant picker + swatches),
  Language (locale picker; English-only shipped, others stubbed), Keyboard shortcuts (open the dialog /
  overrides), Permissions, Diagnostics, Provider usage (table; live data when the daemon advertises it,
  else stub), and — Electron only — Daemon mode (embedded/remote-only) via `getIsElectron()` gating.
- `/settings/projects` + `/settings/projects/:projectKey`: project list + per-project settings.
- `/settings/hosts/:serverId` + `/:hostSection`: per-host settings/management.
- Consume the sprint-013 settings/projects models; reuse primitives + adaptive sheets.

## Out of scope
- Cross-host schedules/command center (task-005). SSH connection settings UI (sprint-025).

## Acceptance criteria
- [ ] Settings index routes to each section; Appearance switches theme live; Language lists locales
      (English active).
- [ ] Provider-usage renders a table (live or stubbed); Daemon-mode section appears only on Electron.
- [ ] Projects + per-host settings screens list and edit their entities (mock client).

## Test / verification plan
- Tests: section routing/registry; appearance switch → theme applied; daemon-mode section gating by
  `getIsElectron()`; projects/hosts list rendering (reuse sprint-013 models).

## Notes
- Provider-usage live data depends on a new daemon RPC (TODO(verify) in PLAN); stub until available.
