# Task 004 — Settings IA, projects screens, left-sidebar shell

- **Sprint:** sprint-013-app-navigation-screens
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
- `clean-room-scope/features/localization.md` (General → Language), `clean-room-scope/features/
  keyboard-shortcuts.md` (Shortcuts section), `clean-room-scope/features/provider-usage.md`
  (host/About provider-usage section) — depends on task-005 of sprint-012 for the underlying engines
- `clean-room-scope/features/desktop-app.md` § Local vs. remote daemon mode (General → Daemon section) —
  the `DesktopDaemonMode` bridge itself is built in sprint-018/task-001; this task only wires the toggle
  UI

## What to build
- Settings: one view-model-driven surface (`root|section|host|projects|project`); app + host sidebar
  groups (desktop-only sections filtered off-desktop; host picker with local-first + "Add host"); section
  content (General including the **Language** picker (localization.md), Daemon, Appearance [theme/fonts/
  font-size + live preview], Daemon [desktop-only — `DesktopDaemonMode` toggle ("Run a daemon on this
  computer" embedded/remote-only), with a confirmation when disabling it while it's the only saved
  host; see desktop-app.md § Local vs. remote daemon mode], Shortcuts [desktop — full binding list
  grouped by section, per-row combo override editor + reset, reset-all; keyboard-shortcuts.md],
  Integrations, Permissions [desktop — Notifications/Microphone grant-state rows with
  re-request/open-OS-settings actions], Diagnostics
  [audio test + an app-diagnostic-report action + a provider-diagnostic sheet], About; host
  Connections/Agents/Workspaces/Providers [+ a **Provider Usage** section per provider-usage.md when the
  host advertises `providerUsageList`] /Host); responsive split (wide 320px+detail, replace-nav; compact
  list→detail, push-nav) with the documented back behavior; add/remove-host flows.
- Projects: cross-host list (loading/empty/card list + per-host error banner) and per-project settings
  (editable-host resolution, revision-based config, worktree-lifecycle + scripts/services + metadata-prompt
  sections).
- Left sidebar: chrome gating (known-host routes only), pinned (wide, resizable, hidden in focus mode) vs
  overlay + edge-swipe (compact); active-host resolution; grouped workspace list (grouping selector +
  refresh + skeleton); footer (Add project / Home / Settings / host switcher); host switching that
  preserves the equivalent route.

## Out of scope
- Workspace screen content (sprint-014). Composer (sprint-015). Feature panels (sprint-016).

## Acceptance criteria
- [ ] Settings renders as a 320px+detail split (replace-nav) on wide and list→detail (push-nav) on
      compact; desktop-only sections hidden off-desktop; Appearance preview reflects live tokens.
- [ ] Projects list + per-project config (revision-based) work across hosts; metadata-prompt fields edit.
- [ ] The sidebar appears only on known-host routes, opens via edge-swipe on compact / pins on wide, and
      host switching preserves the equivalent route.
- [ ] The Language picker switches every visible string live; Shortcuts lists/edits/resets bindings
      (grouped by section, per-OS combo display); Permissions shows live OS grant state; Diagnostics
      produces a shareable report; Provider Usage renders per-provider balances/windows when supported.
- [ ] Settings → Daemon (desktop-only) toggles `DesktopDaemonMode` and warns before disabling the
      embedded daemon if it's the only saved host.

## Test / verification plan
- Tests: settings view resolution + compact/wide nav verb; host-section slug normalization; sidebar
  active-host + route-preserving host switch; projects loading/empty/error states.

## Notes
- Full project-settings menu actions + host connection-row actions are TODO(verify).
