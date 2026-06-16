# Task 004 — Settings IA, projects screens, left-sidebar shell

- **Sprint:** sprint-014-app-navigation-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001

## Goal
Implement the settings information architecture (app/host/project), the projects screens, and the global
left-sidebar shell with host switching.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Settings information architecture,
  § Projects screens, § Global navigation shell
- `clean-room-scope/architecture/config.md`, `clean-room-scope/architecture/structured-generation.md`

## What to build
- Settings: one view-model-driven surface (`root|section|host|projects|project`); app + host sidebar
  groups (desktop-only sections filtered off-desktop; host picker with local-first + "Add host"); section
  content (General, Daemon, Appearance [theme/fonts/font-size + live preview], Shortcuts, Integrations,
  Permissions, Diagnostics, About; host Connections/Agents/Workspaces/Providers/Host); responsive split
  (wide 320px+detail, replace-nav; compact list→detail, push-nav) with the documented back behavior; add/
  remove-host flows.
- Projects: cross-host list (loading/empty/card list + per-host error banner) and per-project settings
  (editable-host resolution, revision-based config, worktree-lifecycle + scripts/services + metadata-prompt
  sections).
- Left sidebar: chrome gating (known-host routes only), pinned (wide, resizable, hidden in focus mode) vs
  overlay + edge-swipe (compact); active-host resolution; grouped workspace list (grouping selector +
  refresh + skeleton); footer (Add project / Home / Settings / host switcher); host switching that
  preserves the equivalent route.

## Out of scope
- Workspace screen content (sprint-015). Composer (sprint-016). Feature panels (sprint-017).

## Acceptance criteria
- [ ] Settings renders as a 320px+detail split (replace-nav) on wide and list→detail (push-nav) on
      compact; desktop-only sections hidden off-desktop; Appearance preview reflects live tokens.
- [ ] Projects list + per-project config (revision-based) work across hosts; metadata-prompt fields edit.
- [ ] The sidebar appears only on known-host routes, opens via edge-swipe on compact / pins on wide, and
      host switching preserves the equivalent route.

## Test / verification plan
- Tests: settings view resolution + compact/wide nav verb; host-section slug normalization; sidebar
  active-host + route-preserving host switch; projects loading/empty/error states.

## Notes
- Full project-settings menu actions + host connection-row actions are TODO(verify).
