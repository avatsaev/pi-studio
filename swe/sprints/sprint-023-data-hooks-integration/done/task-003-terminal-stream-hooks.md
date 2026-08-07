# Task 003 — Terminal stream controller & hooks

- **Sprint:** sprint-023-data-hooks-integration
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-009 (terminal server), sprint-007 (binary frame router)

## Goal
Build the terminal stream controller that manages xterm ↔ daemon binary frames, and React hooks
for terminal session lifecycle.

## Scope references
- `clean-room-scope/features/terminals.md`
- `clean-room-scope/architecture/websocket-protocol.md` § binary frames

## What to build
- **Terminal stream controller**: subscribes to a terminal slot via the client binary frame router;
  buffers output when tab is backgrounded; writes input from xterm to the WS; handles resize
  (debounced, dedup); restore from snapshot on reconnect.
- **Session retention**: ref-counted sessions survive pane unmount (LRU keepalive from sprint-020);
  clean up on workspace close.
- **Hooks**: `useTerminalSession(serverId, terminalId)` → returns { status, write, resize, terminal
  instance }; `useWorkspaceTerminals(workspaceId)` → list of terminal IDs for the workspace.
- **xterm integration**: create `Terminal` instance (+ fit/weblinks/search addons), attach to DOM ref,
  wire controller output → terminal.write, terminal.onData → controller.write.

## Acceptance criteria
- [ ] Terminal renders live PTY output from the daemon and sends keystrokes back.
- [ ] Resize only fires from the focused, claiming pane (debounced + dedup).
- [ ] Backgrounding a tab preserves scrollback; returning resumes without re-subscribe.
- [ ] Reconnect restores from snapshot when advertised.

## Test / verification plan
- Controller unit tests: subscribe/input/output wiring with mock binary router.
- Session retention: mount → unmount → remount → verify no re-subscribe.
- Resize dedup: multiple rapid resizes → verify only distinct values sent.
