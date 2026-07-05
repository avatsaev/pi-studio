# Task 004 — In-app browser panes (webview)

- **Sprint:** sprint-018-desktop
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Implement the embedded in-app browser panes (Electron `<webview>`), acknowledging the documented v1
cross-window limitation.

## Scope references
- `clean-room-scope/features/desktop-app.md` § Bridge capabilities (Browser panes), § Known v1 limitations

## What to build
- Embedded `<webview>` browser pane subsystem with an attach/registration flow and an active-browser
  id.
- Wire menu Reload to the active browser webview.
- Document the v1 limitation: the active-browser id + webview registration queue are process-global,
  so with browser panes open in two windows a Reload can target the other window's webview and
  near-simultaneous attach can register under the wrong browser id.

## Out of scope
- Per-window webview isolation (the fix for the v1 limitation).

## Acceptance criteria
- [ ] A browser pane loads a URL inside a window via `<webview>`.
- [ ] Menu Reload targets the active browser webview.
- [ ] The process-global v1 limitation is documented in code comments and behavior matches it.

## Test / verification plan
- Tests: `npx vitest run packages/desktop/.../browser-panes.test.ts` — attach/registration + active-id
  selection (mock webview).
- Manual: open a browser pane and reload it.

## Notes
- Per-window browser panes are explicitly v1-limited (TODO(verify) current scope before isolating).
