# Task 003 — Terminal pane (xterm)

- **Sprint:** sprint-022-feature-panel-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-020; sprint-016/task-004 (terminal model), sprint-007/task-003 (terminal stream router)

## Goal
Build the tiled `terminal` panel: an `@xterm/xterm` emulator wired to the terminal-stream router, with
snapshot restore, resize-from-claiming-pane, and a compact key bar.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § terminal pane
- `clean-room-scope/features/terminals.md`, `clean-room-scope/architecture/client-app-runtime.md`

## What to build
- An xterm instance (+ addons: fit, web-links, search, webgl, clipboard, unicode11) themed from
  `colors.terminal` + mono font; subscribe to one terminal via the sprint-007 router (unsubscribe prev),
  write output only when workspace-focused + active, send input via a bounded pending queue.
- Resize: only the claiming, focused, visible pane sends resize (dedup identical sizes) per sprint-016
  `terminal-pane.ts`; debounced on layout change.
- Reconnect/restore: subscribe with visible-snapshot restore when advertised; snapshot cache per
  `serverId:cwd`, replay on ready, clear on restore/exit; ref-counted sessions survive pane remounts
  (LRU keepalive from sprint-020/task-003).
- Compact key bar (Esc/Tab/Ctrl/arrows/Shift/Alt/…): sticky-modifier chords from `terminal-pane.ts`.
- xterm web-links → resolve local file paths → open in workspace; status (attaching/connected/exited).

## Out of scope
- Explorer/preview (task-001). Git (task-002). Browser/subagents (task-004).

## Acceptance criteria
- [ ] The pane streams live PTY output, sends input, resizes only from the claiming focused pane, and
      rehydrates from the snapshot after reconnect.
- [ ] The compact key bar inserts special keys + Ctrl chords.
- [ ] Backgrounding the tab keeps the session + scrollback (LRU keepalive).

## Test / verification plan
- Tests (`@xterm/headless`): router subscribe/input/resize wiring + dedup; restore rehydrate; key-bar
  chord emission (reuse sprint-016 model).

## Notes
- Terminal is web + Electron; no WebView leaf. Resize debounce timing TODO(verify).
