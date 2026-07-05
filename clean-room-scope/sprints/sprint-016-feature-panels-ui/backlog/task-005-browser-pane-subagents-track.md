# Task 005 — Browser pane & subagents track

- **Sprint:** sprint-016-feature-panels-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; task-001 (sprint-014, subagents policy)

## Goal
Implement the embedded browser pane (Electron) and the subagents-track UI.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § Browser pane (embedded), § Subagents track
- `clean-room-scope/features/subagents.md`, `clean-room-scope/features/service-proxy.md`

## What to build
- Browser pane (Electron/web-only): an embedded web view (platform-split leaf) with a URL/address bar,
  back/forward/reload/stop, loading + error states, and the service-proxy hostname integration (open a
  workspace dev service by its generated hostname); availability gated to Electron (`getIsElectron()`);
  non-Electron shows an unsupported/open-externally affordance.
- Subagents track: the track component rendered above the composer in the parent agent's pane — a row of
  child-agent chips/cards (label + status dot + attention), select → focus the child tab, per-row archive
  button (X) → confirm → archive (cascade per the subagents rules), and the documented tab-close behavior
  (root = global archive, subagent = layout-only).

## Out of scope
- Explorer/preview (tasks 001–002). Git (task-003). Terminal (task-004). Service-proxy server
  (sprint-009).

## Acceptance criteria
- [ ] The browser pane navigates (address bar + back/forward/reload) inside Electron and opens a workspace
      service by its proxy hostname; non-Electron shows the unsupported affordance.
- [ ] The subagents track lists child agents with status/attention, focuses a child on select, and
      archives a child via X → confirm (cascade).

## Test / verification plan
- Tests: browser nav-state machine + Electron gating; subagents-track chip building + archive-confirm
  wiring (mock client).

## Notes
- Use `react-native-webview` for the embedded pane (see design-system § UI technology stack). Proxy-URL
  resolution is TODO(verify).
