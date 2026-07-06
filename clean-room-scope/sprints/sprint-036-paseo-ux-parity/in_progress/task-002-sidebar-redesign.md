# Task 002 — Left sidebar redesign (Paseo parity)

- **Sprint:** sprint-036-paseo-ux-parity
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (tokens)

## Problem
The sidebar shows raw **absolute cwd paths** as list items and looks unpolished. It must match
Paseo's `sidebar-workspace-list.tsx` / `agent-list.tsx`.

## Reference
- `~/DEV/paseo/packages/app/src/components/sidebar-workspace-list.tsx`,
  `~/DEV/paseo/packages/app/src/components/agent-list.tsx`, `docs/design.md` §3, §5, §7.
- Pi-Studio files: `packages/app/src/components/nav/LeftSidebar.tsx`,
  `packages/app/src/screens/sidebar.ts`, `packages/app/src/router/AppShell.tsx` (builds the rows).

## What to build
- **Labels**: derive a friendly name — project/repo name or `basename(cwd)` (+ git branch when
  relevant); the agent title when set. Show the absolute path only as a tooltip, never as the row label.
- **Grouping**: group workspaces by project with a `medium`-weight section header (`foregroundMuted`),
  spacious section rhythm; lists-as-pages use spacing+surface, not borders (design.md §5).
- **Rows**: status dot + primary title (`foreground`, `normal`) + secondary metadata
  (`foregroundMuted`), last-activity; 8–12px vertical padding; hover = `surfaceSidebarHover`;
  active = `foreground` + subtle surface. Kebab/context menu for row actions (archive, rename).
- **Sidebar background** = `surfaceSidebar` (distinct from main). Footer: host switcher + new-workspace.
- Truncate long titles with ellipsis; no horizontal overflow/scroll of paths.

## Acceptance criteria
- [ ] No absolute paths shown as labels — friendly names only (path as tooltip).
- [ ] Workspaces grouped by project with clean section headers and Paseo spacing.
- [ ] Hover/active/status styling matches Paseo; sidebar bg distinct from main.
- [ ] App typecheck + vitest + `build:web` pass.

## Test / verification plan
- Unit: label-derivation helper (project name / basename / branch) with edge cases.
- Visual: screenshot the sidebar with several sessions; compare to Paseo.
