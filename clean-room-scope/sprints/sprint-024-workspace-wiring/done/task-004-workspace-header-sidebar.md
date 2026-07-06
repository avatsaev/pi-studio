# Task 004 — Workspace header, sidebar & shortcut wiring

- **Sprint:** sprint-024-workspace-wiring
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** tasks 001–003; sprint-018 (nav chrome)

## Goal
Wire the workspace header (agent status, project label, controls) and sidebar (real workspace
list, host switcher) to live data, and connect the shortcut dispatcher to workspace actions.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § header, § sidebar integration
- `clean-room-scope/features/keyboard-shortcuts.md`

## What to build
- **Workspace header**: show agent status dot + label, project name, branch name (from git hook),
  provider usage meter, "Stop agent" / "New message" primary actions. Wire to session store +
  git status hook.
- **Sidebar wiring**: LeftSidebar receives real hosts (from connection store), real workspaces
  (from workspaces query), real active workspace (from route state). Workspace items show status
  dot + last activity time. Host switcher shows connection status per host.
- **Command center wiring**: CommandCenter receives real workspace list + session list for search;
  selecting a workspace navigates to it; selecting a session opens its workspace.
- **Shortcut dispatcher**: wire workspace-scoped shortcuts (Cmd+T new terminal, Cmd+W close tab,
  Cmd+1-9 switch tab, Cmd+K command center, Cmd+B toggle sidebar, Cmd+Shift+P command palette).
- **Compact switcher**: on narrow viewports, bottom tab bar replaces sidebar (from sprint-020).

## Acceptance criteria
- [ ] Header shows real agent status, project, branch, and controls that trigger mutations.
- [ ] Sidebar lists real workspaces with status; switching workspace navigates.
- [ ] Command center search finds real sessions/workspaces; keyboard shortcuts trigger actions.
- [ ] Compact mode: sidebar hidden, bottom switcher shown.

## Test / verification plan
- Integration: connect to daemon with 2 workspaces → verify sidebar shows both.
- Shortcuts: simulate Cmd+T → verify new terminal tab opened.
- Command center: type workspace name → verify it appears in results.
