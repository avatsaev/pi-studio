# Task 004 — Terminal pane

- **Sprint:** sprint-016-feature-panels-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-007/task-003 (terminal-stream router)

## Goal
Implement the workspace terminal pane (emulator, stream wiring, restore, mobile key bar).

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § Terminal pane
- `clean-room-scope/features/terminals.md`, `clean-room-scope/architecture/client-app-runtime.md`

## What to build
- A terminal emulator panel (platform-split emulator leaf) wired to the terminal-stream router: subscribe
  → render output, send input, resize on layout (debounced), reconnect/rehydrate from the restore snapshot
  on reconnect; themed via the terminal token palette + the mono font.
- Title/descriptor (cwd / command); status (connecting/connected/exited); close (server-side close per the
  workspace bulk-close rules); copy/paste; scrollback.
- Mobile key bar: an accessory row of hard-to-type keys (Esc/Tab/Ctrl/arrows/etc.) and a Ctrl-chord
  helper on compact/native.
- Keepalive: stay mounted-but-hidden under the tab LRU so the session and scrollback survive backgrounding.

## Out of scope
- Explorer/preview (tasks 001–002). Git (task-003). Browser/subagents (task-005). PTY backend + router
  (server sprint-009 / client sprint-007 — consumed here).

## Acceptance criteria
- [ ] The pane renders live PTY output, sends input, resizes on layout, and rehydrates from the restore
      snapshot after reconnect.
- [ ] On compact/native the mobile key bar inserts the special keys + Ctrl chords.
- [ ] Backgrounding the tab keeps the session + scrollback (LRU keepalive).

## Test / verification plan
- Tests: router subscribe/input/resize wiring; restore rehydrate; key-bar chord emission (mock router).

## Notes
- Use `@xterm/xterm` + addons on web (`@xterm/headless` for tests); the native terminal is a WebView leaf
  (see design-system § UI technology stack). Resize debounce timing is TODO(verify).
