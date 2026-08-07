# Task 001 — Decouple the xterm mount from the slot, wire handlers before the first fit

- **Sprint:** sprint-052-terminal-sizing
- **Status:** done
- **Type:** bugfix
- **Estimated size:** S
- **Depends on:** none

## Goal
Restructure `TerminalPanel`'s effects so the emulator mounts as soon as its container exists (not
once a slot arrives) and `onData`/`onResize` are attached **before** the first `fitAddon.fit()` — the
two changes that close the window in which the only size-changing fit of the panel's life fires with
no listener.

## Background / why
The reported bug — "the terminal doesn't use all the space, long commands behave weirdly, deleting
letters leaves ghosts, text scrambles, alignment is all over the place" — is one root cause: the PTY
runs at the 80×24 default (`packages/server/src/terminal/terminal-manager.ts:114-115`) for the whole
life of the terminal, while xterm renders the real grid (~140×35). Every cursor-positioning and
line-wrap decision the shell's line editor makes is calibrated to a width the display does not have.

The mechanism is an ordering defect in `packages/web-client/src/features/terminal/TerminalPanel.tsx`:

1. `:207` calls `fitAddon.fit()`, which **does** resize the frontend grid (80×24 → the real size).
2. `terminal.onResize` is not attached until `:229`. That resize fired into nothing.
3. `node_modules/@xterm/addon-fit/src/FitAddon.ts:44-47` only calls `terminal.resize()` **when the
   proposed dimensions differ from the current ones**, and `Terminal.resize` only emits `onResize` on
   an actual change. So every subsequent `fit()` — the `ResizeObserver`'s initial callback
   (`:233-236`), the `isVisible` effect (`:255-258`) — recomputes the same numbers and is a silent
   no-op. No `Resize` frame is ever sent.

There is an asymmetry worth knowing while working on this, because it is why the defect survived
smoke testing: a panel that mounts **hidden** (a restored terminal that is not its pane's active tab)
works correctly, because the first `fit()` no-ops while unrendered: `proposeDimensions()` bails on
zero render-service cell metrics (`FitAddon.ts:63-65`) when the terminal was opened under
`display:none`, and a `NaN` parent-height parse is caught by `fit()`'s own guard (`:36-38`). So the
later visibility `fit()` does fire `onResize` with the handler attached. Only the
ordinary path — open a terminal and look at it — is broken.

This task is the structural half; task-002 (create-time claim) and task-003 (focus/change claims +
the ownership gate) make the daemon actually learn the size. Keep the existing
`onResize → router.sendResize` wiring, gated exactly like `onData`: it sends only while
`slotRef.current` is non-null, and a resize event fired before the slot exists is dropped — its
effect is captured by task-002's create-time measurement. Consequences to expect, not to "fix":
after this task alone a fresh open still spawns at 80×24 (the one size-changing fit now fires
before the slot exists, so the event has nowhere to go), while a divider drag on a live terminal
starts working. Known interim overshoot: a reattach (slot present at mount) now sends a claim from
the mount-time fit, which violates the passive-attach rule; task-003's ownership gate removes it.
Do not invent an ad-hoc suppression here.

Mounting xterm independently of the slot is a prerequisite for task-002, not a cosmetic change:
`CreateTerminalRequest.cols`/`.rows` can only be filled in by a client that has already measured its
grid, and measuring requires a mounted, laid-out emulator.

## Scope references
- `clean-room-scope/features/terminals.md` § PTY size ownership (the trigger table; this task builds
  the mechanism the triggers fire through)
- `clean-room-scope/features/feature-panels-ui.md` § Terminal pane, § Terminal pane → **Pi-Studio
  implementation contract (web)** (`{ isAttaching, error }` status shape; size claim scoped to the
  focused visible pane)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (the whole effect structure)
- `packages/web-client/src/features/terminal/TerminalPanel.module.css` (`.status` is currently the
  pre-slot state's only styling; the spinner overlay changes shape)
- `packages/web-client/src/features/workspace/TabPanelHost.tsx` (the "hidden but alive, never
  re-parented" invariant this component depends on — do not weaken it)
- `packages/web-client/src/stores/tab-store.ts` (`TerminalTabData`, `useIsTabVisible`)

## What to build
In `TerminalPanel.tsx`, restructure into these effects, preserving every existing invariant:

- **Emulator effect** — deps `[]`-shaped on the container, no longer gated on `slot`. Constructs the
  `Terminal` + `FitAddon`, calls `terminal.open(container)`, attaches `onData` and `onResize`
  **first**, and only then performs the initial `fit()`. Disposes on unmount as today.
- **Subscription effect** — deps `[client, slot]`. Runs `router.subscribeSlot(...)` +
  `subscribe_terminal_request`, and on cleanup `unsubscribe_terminal_request` + local unsubscribe.
  Split out from the emulator so a reconnect (new `client`) re-subscribes without tearing down and
  rebuilding the emulator, which today loses all scrollback on every reconnect.
- **Input gate** — `onData` is attached before a slot exists, so it MUST drop (not throw, not
  buffer-forever) keystrokes while `slotRef.current === null`. A short pre-attach queue flushed on
  subscribe is permitted per `feature-panels-ui.md` § Terminal pane → Input/keys ("bounded pending
  queue flushed once attached + error-free") — bounded and dropped on error, never unbounded.
- **Status surface** — with the emulator mounted from the start there is no full-panel "Starting
  terminal…" replacement. Render `{ isAttaching, error }` as an overlay/row over the live emulator
  per the spec, so the panel no longer swaps its entire subtree once the slot lands.
- Leave untouched: the slot-creation effect's `requestStartedRef`/`isMountedRef` StrictMode
  protocol (`:96-158`), the deferred `kill_terminal_request` on true unmount (`:176-188`), and
  `clientRef`'s every-render refresh. Each guards a specific past bug and its doc comment explains
  which; re-read those comments before moving code near them.

## Out of scope
- Sending any size to the daemon — task-002 (create-time) and task-003 (focus/change).
- Coalescing/dedupe of resize frames — task-004.
- Snapshot replay semantics — task-005.
- Theme/font sourcing, exited-terminal state — sprint-053.

## Acceptance criteria
- [ ] `terminal.onResize` and `terminal.onData` are attached before the first `fitAddon.fit()` call;
      grep confirms no `fit()` precedes the handler registration.
- [ ] The emulator is created once per panel and survives a `client` change (reconnect): scrollback
      written before a reconnect is still on screen after it, and exactly one
      `subscribe_terminal_request` is in flight per `(slot, client)`.
- [ ] Opening a terminal shows the emulator immediately with an attaching indicator over it, not a
      full-panel "Starting terminal…" placeholder that is later replaced.
- [ ] Keystrokes typed before the slot arrives never throw and never reach a nonexistent slot.
- [ ] A resize event fired before the slot exists is dropped without error and without a deferred
      send once the slot arrives.
- [ ] A real tab close still kills the PTY exactly once (`kill_terminal_request` with the right
      slot), and a React StrictMode dev remount still does not: one `Ctrl+T` produces exactly one
      PTY, and closing one tab does not kill another tab's terminal.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` pass.

## Test / verification plan
- Build/typecheck/lint: `npm run build`, `npm run typecheck`, `npm run lint`.
- Tests: `npm test` — no regressions. (No component test is possible here: the root vitest runner
  discovers `.test.ts` under a plain Node environment with no jsdom, which is why this task's proof
  is the manual sequence below and why task-002 extracts the decidable logic into a pure module.)
- Manual, against a real daemon (`npm start`) in a browser with React StrictMode active:
  1. `Ctrl+T` → exactly one terminal appears in `pi-studio terminal ls`; the emulator is visible
     immediately.
  2. Type into it before/while it attaches → no console errors, no lost session.
  3. Write output, then kill the daemon connection and let it reconnect → scrollback intact, output
     resumes.
  4. Open two terminals, close one → `pi-studio terminal ls` shows exactly the other one still live.

## Notes
`useIsTabVisible(tab.id)` is per-pane, not `=== activeTabId`, deliberately (a terminal can be on
screen in one pane while another pane holds the workspace-active tab). Keep reading visibility from
it; do not substitute an `activeTabId` comparison.
