# Task 002 — Pane content router & keepalive mount

- **Sprint:** sprint-024-workspace-wiring
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; sprint-022 (all panel components)

## Goal
Build the pane content router that maps tab kind → panel component, with keepalive mounting so
backgrounded tabs retain state (scroll position, terminal scrollback, editor cursor).

## Scope references
- `clean-room-scope/features/workspace-ui.md` § pane content, § keepalive
- `clean-room-scope/features/feature-panels-ui.md`

## What to build
- **PaneContentRouter**: given a `WorkspaceTab`, render the correct panel component:
  - `timeline` → Timeline + Composer (with SubagentsTrack)
  - `terminal` → TerminalPane (with xterm instance)
  - `explorer` → Explorer sidebar (floating or pinned)
  - `file` → FilePreviewPane
  - `browser` → BrowserPane
  - `git` → GitChangesPanel / PrActivityPanel
- **Keepalive wrapper**: up to 3 backgrounded panes stay mounted (hidden via CSS `display:none` +
  `visibility:hidden`) to preserve DOM state. LRU eviction beyond cap 3.
- **Tab → props mapping**: resolve each tab's props from hooks (session store for timeline, terminal
  hooks for terminal, explorer hooks for file tree, etc).
- **Focus management**: only the active pane receives keyboard events; terminal captures focus on
  click; timeline auto-scrolls only when active.
- **Loading/error boundaries**: each pane wrapped in Suspense + ErrorBoundary; errors show per-pane
  error UI (not crash the whole workspace).

## Acceptance criteria
- [ ] Each tab kind renders the correct panel with real data from hooks.
- [ ] Switching tabs preserves state (terminal scrollback, scroll position, file preview).
- [ ] LRU keepalive evicts the oldest backgrounded pane after cap 3.
- [ ] Errors in one pane don't crash adjacent panes.

## Test / verification plan
- Integration: render workspace with timeline + terminal tabs → verify both mount.
- Keepalive: open 5 tabs, switch through them → verify only 3 backgrounded stay mounted.
- Error boundary: throw in file preview → verify timeline still works.
