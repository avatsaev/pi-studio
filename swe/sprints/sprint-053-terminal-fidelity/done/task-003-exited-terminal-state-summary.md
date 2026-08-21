# Task 003 — Surface an exited PTY instead of leaving a zombie tab — Summary

- **Sprint:** sprint-053-terminal-fidelity
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

**Chosen mechanism** (per the task's "narrowest mechanism" instruction): the existing
`terminals_update` JSON broadcast, extended to also fire on self-exit, not only on the three RPC
paths that already sent it. No new binary opcode, no protocol-package schema — matches "Out of
scope" exactly.

### Daemon (`packages/server/src/terminal`)
- `TerminalManager` gained an `onTerminalExit(listener)` seam: a `Set` of listeners fired once,
  from inside `onExit`, after the map entry is already deleted and subscribers cleared. Both
  self-exit (PTY `exit` callback) and `kill()` funnel through this single call site — `kill()`
  itself calls `onExit` a second time as before, but the pre-existing `if (managed.entry.closed)
  return;` guard at the top of `onExit` means the listeners still fire exactly once.
- `registerTerminalHandlers` wires `manager.onTerminalExit(...)` to the same
  `deps.broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() })`
  call `create`/`rename`/`start_workspace_script` already use. `kill_terminal_request`'s own
  explicit broadcast was **removed** — it would now duplicate the one `manager.kill()` triggers
  synchronously via the new listener. All five paths (create, rename, kill, self-exit,
  start_workspace_script) now produce exactly one broadcast each, from two call sites instead of
  four.

### Web client
- `TerminalTabData` gained an optional `exited?: boolean` field (sticky; no "restart terminal"
  affordance, matching "Out of scope").
- New `hooks/use-terminal-exit-watch.ts`: a local `TerminalsUpdateMessage` interface + type-guard
  (`isTerminalsUpdate`), following the `checkout_status_update`/`file_changed` convention (root
  AGENTS.md § Protocol overview) — no protocol-package schema. The pure reconciliation logic is
  extracted into an exported `reconcileLiveTerminals(liveSlots)` (mirrors
  `use-terminal-restore.ts`'s `runTerminalRestore` export, for direct unit testing under this
  repo's DOM-less vitest environment). It marks every terminal tab whose `data.slot` is a known,
  non-null number absent from the daemon's live list as `exited: true` — skipping tabs with
  `slot === null` (a freshly created tab whose `create_terminal_response` hasn't resolved yet; the
  create broadcast lands first and would otherwise look like an instant exit) and tabs already
  exited (sticky, no redundant store write). Mounted once in `app.tsx`'s `Boot()`, alongside
  `useTerminalRestore()`.
- `TerminalPanel.tsx`:
  - `exitedRef` mirrors `data.exited` every render (same pattern as the existing `clientRef`), so
    the `onData` handler (attached once, empty-deps mount effect) and the true-unmount kill effect
    (also empty-deps) always see the current value, not whatever it was when their effect last ran.
  - `onData` returns immediately when `exitedRef.current` is true — no encode, no send, no queueing.
  - A new effect (`[data.exited]`) sets `cursorBlink = false` and calls `terminal.blur()` once
    exited — stops the cursor from looking alive without touching any other rendering; the last
    real screen is left completely alone.
  - The true-unmount kill effect now checks `exitedRef.current` and skips sending
    `kill_terminal_request` entirely for an already-exited slot, rather than sending it and relying
    on the pre-existing `.catch(() => {})` to swallow the `{ ok: false }`/error.
  - Render: a `.exitedBanner` (bottom-anchored bar, `position: absolute; inset` only on
    left/right/bottom — NOT `inset: 0` like the attach/error `.statusOverlay`) shows "Terminal
    exited" without ever replacing the terminal's own DOM node, so scrollback stays fully visible
    and interactive (selectable/copyable) underneath it.
- `TabStrip.tsx`'s `TabItem`: an exited terminal tab is dimmed (`opacity: 0.6`, same mechanism as
  the existing drag-opacity) and its tooltip gets a `(exited)` suffix. The tab stays open and
  closable — no auto-close, no restart affordance.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/terminal/terminal-manager.ts` | `exitListeners` set + `onTerminalExit()`, fired from `onExit` |
| `packages/server/src/terminal/terminal-rpc.ts` | wired `manager.onTerminalExit` to the broadcast; removed `kill_terminal_request`'s now-duplicate explicit broadcast |
| `packages/server/src/terminal/terminal-manager.test.ts` | `FakePty.simulateExit()` + 3 new tests (self-exit fires once, kill doesn't double-fire, unsubscribe works) |
| `packages/server/src/terminal/terminal-rpcs.test.ts` | `FakePty` gained a real exit-callback + `simulateExit()`/`killed`; 2 new tests (self-exit broadcasts once; kill broadcasts exactly once, not twice) |
| `packages/web-client/src/stores/tab-store.ts` | `TerminalTabData.exited?: boolean` |
| `packages/web-client/src/hooks/use-terminal-exit-watch.ts` | new — listener + exported `reconcileLiveTerminals` |
| `packages/web-client/src/hooks/use-terminal-exit-watch.test.ts` | new — 7 unit tests |
| `packages/web-client/src/app.tsx` | mounts `useTerminalExitWatch()` in `Boot()` |
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | `exitedRef`, input-disable, cursor-stop effect, skip-kill-on-unmount, exited banner render |
| `packages/web-client/src/features/terminal/TerminalPanel.module.css` | `.exitedBanner` |
| `packages/web-client/src/features/workspace/TabStrip.tsx` | exited tab dimming + tooltip suffix |

## How it satisfies the scope
Matches `feature-panels-ui.md` § Terminal pane → Streaming ("exit sets 'Terminal exited'") and §
Error Handling ("PTY exits → Notify subscribers; terminal closed"), and `terminals.md` § Behavior
(`kill(slot)`: "terminate PTY; notify subscribers"). The ordering hazard flagged in the task's
Background section — `onExit` deletes the map entry before clearing subscribers, and `kill()` calls
`onExit` synchronously — is exactly what the exit-listener's placement (after both of those, once
per `onExit` invocation thanks to the `closed` guard) and the removed duplicate broadcast are built
around.

## Build & test results
```
$ npx vitest run packages/server packages/web-client
 Test Files  152 passed (152)
      Tests  1983 passed (1983)

$ npx tsc -b packages/web-client packages/server --force
(clean)

$ npx oxlint packages/web-client/src packages/server/src/terminal
(only pre-existing, unrelated warnings elsewhere in the packages — zero new)

$ npx oxfmt --check <every changed file>
(clean)

$ npm run build:server && npm run build:web-client
(both succeed; pre-existing chunk-size warnings only)
```

## Acceptance criteria
All seven boxes ticked in the task file. Six are unit-verified directly (see the file for exactly
which test proves which claim); the "within a second"/devtools-frame/CLI-parity claims are
structurally guaranteed by the same code path but their live-timing confirmation is deferred to
task-006's consolidated E2E sweep, per the user's explicit "stop smoke testing, move on" during
this task (prior tasks in this sprint had done a live browser pass per-task; sprint-053/task-006
already exists specifically to do one consolidated pass at sprint close, so nothing is lost by
deferring rather than duplicating that work here).

## Follow-ups / TODO(verify)
- Exit codes/reason are not surfaced in the UI — `onExit` does not currently carry one (task's own
  "Out of scope"); a real follow-up if ever wanted, not plumbed here.
- Live browser confirmation of all seven acceptance criteria is task-006's responsibility.
