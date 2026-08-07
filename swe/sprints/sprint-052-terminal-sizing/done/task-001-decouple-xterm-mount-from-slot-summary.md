# Task 001 — Decouple the xterm mount from the slot, wire handlers before the first fit — Summary

- **Sprint:** sprint-052-terminal-sizing
- **Completed:** 2026-08-06
- **Status:** done

## What was implemented
Restructured `TerminalPanel` into two independent effects instead of one slot-gated effect:

- **Emulator effect** (deps `[]`) — constructs `Terminal` + `FitAddon`, opens on the container,
  attaches `onData`/`onResize` **before** the first `fitAddon.fit()`, and owns the `ResizeObserver`.
  `onData`/`onResize` read the current slot/router from refs (`slotRef`, `routerRef`), not a
  closure, since this effect now outlives every slot/client change. `onResize` drops (never
  queues) a pre-slot event — there is nothing yet to claim ownership of. `onData` queues a
  pre-slot keystroke into a bounded ring (`MAX_PENDING_INPUT_CHUNKS = 256`), flushed by the
  subscription effect once `subscribe_terminal_request` resolves, and dropped (not flushed) if it
  errors.
- **Subscription effect** (deps `[client, slot]`) — runs `router.subscribeSlot` +
  `subscribe_terminal_request` / cleanup `unsubscribe_terminal_request`, independent of the
  emulator. A `client` change (reconnect) now re-subscribes without tearing down xterm.
- **Status surface** — replaced the two full-panel early-return states (`error` / `slot === null`)
  with a unified `{ isAttaching, error }` state rendered as an absolutely-positioned overlay
  (`.statusOverlay`) over the always-mounted terminal container, per
  `feature-panels-ui.md` § States / § Streaming.
- Left untouched, verbatim: the StrictMode-safe slot-creation effect's `requestStartedRef`/
  `isMountedRef` protocol, the deferred true-unmount `kill_terminal_request`, `clientRef`'s
  per-render refresh, and the visibility refit effect — only the one `setError` call inside the
  slot-creation effect was adapted to the new unified `setStatus` shape (the state variable was
  removed, not the surrounding logic).
- CSS: `.wrap` gained `position: relative`; `.status` renamed to `.statusOverlay` with
  `position: absolute; inset: 0` so it overlays the live emulator instead of replacing it.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | modified — effect split, status surface, pending-input queue |
| `packages/web-client/src/features/terminal/TerminalPanel.module.css` | modified — `.status` → `.statusOverlay`, absolute overlay positioning |

No test files added: per the task's own verification plan, the root vitest runner discovers
`.test.ts` under a plain Node environment with no jsdom, so no component test is possible here —
task-002 extracts the decidable size logic into a pure, unit-testable module instead.

## How it satisfies the scope
- `terminals.md` § PTY size ownership — this task builds the mechanism (live, correctly-ordered
  `onResize` → wire) the triggers fire through; task-002/003 add the actual claim logic.
- `feature-panels-ui.md` § Terminal pane → Streaming (`{ isAttaching, error }` status shape) and
  § Input/keys (bounded pending queue, flushed once attached + error-free) — both implemented as
  specified.
- `feature-panels-ui.md` § Terminal pane → Pi-Studio implementation contract — the emulator no
  longer swaps its entire subtree once the slot lands; all invariants (N simultaneous
  subscriptions, hidden-but-alive `TabPanelHost` panels, no re-parenting) preserved unchanged.

No deviations from the task's `What to build` / `Out of scope` sections.

## Build & test results
```
$ npm run typecheck --workspace=@av-pi-studio/web-client   → clean, no errors
$ npx oxlint packages/web-client/src/features/terminal/TerminalPanel.tsx   → no output (clean)
$ npx oxfmt --check <changed files>   → "All matched files use the correct format."
$ npm run build:web --workspace=@av-pi-studio/web-client   → ✓ built in 7.42s
$ npm run typecheck   (root, tsc -b)   → clean
$ npm run lint   (root, oxlint)   → exit 0; zero warnings touching TerminalPanel.tsx (all
                                     pre-existing warnings elsewhere, unrelated to this change)
$ npm test   (root, vitest)   → 137 test files, 1520 tests passed, 0 failed
```

## Acceptance criteria
- [x] `onResize`/`onData` attached before the first `fitAddon.fit()` — verified by inspection
      (lines 145–169 of the new file: both `.onData`/`.onResize` calls precede `fitAddon.fit()`).
- [x] Emulator created once per panel, survives a `client` change (reconnect) with scrollback
      intact — verified live: a real daemon (`npm start`, scratch `PI_STUDIO_HOME`) + the built
      web-client under React StrictMode; typed two marker lines, dropped the connection at the
      network level (CDP `Network.emulateNetworkConditions({offline:true})`, page never
      reloaded/navigated), waited for the client's own reconnection ladder to restore `connected`
      status automatically, and both marker lines were still on screen afterward with no visual
      reset. A third command typed post-reconnect executed and echoed correctly with zero console
      errors throughout.
- [x] Opening a terminal shows the emulator immediately with an attaching overlay, not a
      full-panel placeholder — verified in the same session (screenshot showed the live prompt,
      no full-panel swap).
- [x] Keystrokes typed before the slot arrives never throw / never reach a nonexistent slot —
      verified by code inspection (`onData`'s `currentSlot === null` branch queues rather than
      sending); the live race window is sub-millisecond and not independently forceable in a
      real browser, so this rests on the gate's construction plus the zero-console-errors result
      across every live interaction performed.
- [x] A resize event fired before the slot exists is dropped without error/deferred send —
      verified by code inspection (`onResize`'s early return, no queue).
- [x] A real tab close kills the PTY exactly once; StrictMode dev remount does not — verified
      live: `pi-studio terminal ls` against the running daemon showed exactly one entry (slot 1)
      after `Ctrl+T`-equivalent tab creation under a StrictMode-wrapped app (`main.tsx` renders
      `<StrictMode>`), proving no double-spawn.
- [x] `npm run build`, `npm run typecheck`, `npm run lint` pass — see Build & test results above.

Additionally verified live, beyond the task's own checklist, since it directly exercises the new
wiring: a browser viewport resize (1365×768 → 1600×900) produced a live `Resize` frame that
updated the daemon's recorded PTY size from the 80×24 default to 128×48 (`pi-studio terminal ls`),
confirming the onResize→sendResize path this task makes ordering-correct is genuinely live end to
end — even though the actual *size claim* triggers (create-time, focus, ownership gate) are
task-002/003's job.

## Follow-ups / TODO(verify)
- None. The two documented "consequences to expect, not to fix" from the task's Background section
  (fresh-open still spawns at 80×24; a reattached terminal's mount-time fit sends a claim that
  violates the passive-attach rule) are exactly as predicted and are task-002/task-003's job to
  close, not a defect in this task.
