# Task 001 — Workspace route state & tab layout store

- **Sprint:** sprint-024-workspace-wiring
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-023, sprint-020 (workspace shell)

## Goal
Wire the workspace screen to real route params and build the Zustand tab layout store that
persists tab arrangement, pane splits, and active tab per workspace.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § tab layout persistence, § route state
- `clean-room-scope/architecture/client-app-runtime.md` § workspace routing

## What to build
- **Route state hook**: `useWorkspaceRouteState(workspaceId)` — resolves workspace from URL params,
  validates workspace exists on connected host, handles "workspace not found" / "host disconnected"
  gate states. Returns the workspace descriptor or gate view.
- **Tab layout store** (Zustand + persist to KV): per-workspace state: ordered tabs, split tree,
  active tab ID, pinned tabs. Actions: open tab, close tab, reorder (drag), split horizontal/vertical,
  resize split, focus pane, merge panes.
- **Tab model integration**: resolve `WorkspaceTab` → panel kind (timeline, terminal, explorer, file,
  browser, git); generate initial seed tabs from workspace config (timeline always open).
- **Layout constants**: min pane size (15%), max split depth (3), default split ratio (50/50).
- **Persistence**: debounced save to KV store; restore on workspace re-open; handle stale tabs
  (terminal closed, file deleted → mark as "stale" with warning badge).

## Acceptance criteria
- [ ] Navigating to /h/:serverId/workspace/:workspaceId resolves and renders the workspace.
- [ ] Tabs can be opened/closed/reordered; split panes created/resized/merged.
- [ ] Layout persists across page refreshes; stale tabs are handled gracefully.
- [ ] Initial seed includes timeline tab; workspace not found shows gate view.

## Test / verification plan
- Store unit tests: open/close/reorder/split/merge actions.
- Persistence: save → reload → verify layout restored.
- Stale tab: close terminal on server → verify tab shows stale indicator.
