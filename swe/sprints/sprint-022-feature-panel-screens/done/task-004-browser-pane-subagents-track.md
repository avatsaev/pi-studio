# Task 004 — Browser pane & subagents track

- **Sprint:** sprint-022-feature-panel-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint-020; sprint-016/task-005 (browser + subagents-track models)

## Goal
Build the embedded browser pane (Electron `<webview>` + web placeholder) and the subagents track above
the composer.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § browser pane, § subagents track
- `clean-room-scope/features/subagents.md`, `clean-room-scope/features/service-proxy.md`

## What to build
- Browser pane: on Electron, an embedded `<webview>` with a chrome row (back/forward/reload-stop, URL
  input, dev-only devtools/element-selector), nav-state store, favicon/title/loading/error, new-tab
  handling, and service-proxy hostname open; on web, a "Browser is desktop-only" placeholder + open-
  externally. Gated via `getIsElectron()` + guarded dynamic import of the `.electron` webview module.
  Consume the sprint-016 browser model (URL validation, nav-state updates).
- Subagents track: a collapsible strip above the composer listing child agents (label + status dot +
  attention), select → focus child tab, hover-revealed (web) / always-shown (compact) archive button →
  confirm → archive (cascade). Consume the sprint-016 subagents-track model; reuse the AgentList visuals.

## Out of scope
- Explorer/preview (task-001). Git (task-002). Terminal (task-003).

## Acceptance criteria
- [ ] On Electron the browser pane navigates (address bar + back/forward/reload) and opens a workspace
      service by proxy hostname; on web it shows the desktop-only placeholder.
- [ ] The subagents track lists children with status/attention, focuses on select, and archives via
      X → confirm (cascade), archive button hover-gated on web / always-on compact.

## Test / verification plan
- Tests: browser nav-state + URL validation + electron gating (reuse model); subagents-track membership/
  chip/archive-confirm (reuse model).

## Notes
- The `<webview>` module is Electron-only (dynamic import); the web bundle must not include it.
- Completes the UI render layer; sprints 023–025 add relay, desktop packaging, and SSH.
