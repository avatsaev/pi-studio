# Task 004 — Coalesce refits and resize claims; guard the ResizeObserver feedback loop

- **Sprint:** sprint-052-terminal-sizing
- **Status:** done
- **Type:** bugfix
- **Estimated size:** XS
- **Depends on:** task-003

## Goal
Make a continuous gesture (divider drag, window resize) produce **one** refit + one `Resize` claim
once the size settles, instead of one per animation frame, and stop the `ResizeObserver` → `fit()` →
observed-size-change → `ResizeObserver` loop from re-entering.

## Background / why
`terminals.md` § PTY size ownership: "Resize frames SHOULD be coalesced client-side — one frame once
the size settles, not one per animation frame — so a divider drag does not produce a `SIGWINCH` storm
and a full shell redraw per intermediate width."

Today `TerminalPanel.tsx:233-236` calls `fitAddon.fit()` synchronously inside the `ResizeObserver`
callback. Each fit that changes dimensions resizes the emulator, which changes the observed box, which
schedules another callback; and after task-003 each of those that yields a new grid also sends a
`Resize`, so a one-second divider drag issues dozens of `ioctl(TIOCSWINSZ)` + `SIGWINCH` pairs. Every
one makes the shell redraw its prompt and edit line at a new width — the visible result is a flickering,
stuttering terminal during any drag even once the sizes are correct. Browsers also log
"ResizeObserver loop completed with undelivered notifications" for exactly this pattern.

The dedupe from task-003 bounds the *wire* traffic to genuinely distinct widths, but a drag genuinely
passes through every intermediate width, so dedupe alone does not solve this — coalescing does.

## Scope references
- `clean-room-scope/features/terminals.md` § PTY size ownership (final bullet)
- `clean-room-scope/features/feature-panels-ui.md` § Terminal pane → Input/keys
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (`ResizeObserver` + the `isVisible`
  refit)
- `packages/web-client/src/features/workspace/pane-layout-view.ts` (panel rects are recomputed per
  layout change; this is what the observer sees move)

## What to build
- A single scheduled-refit seam in `TerminalPanel`: observer callbacks and the visibility effect
  request a refit rather than performing one. The scheduler coalesces to one `fit()` per animation
  frame plus a short trailing settle (~60 ms) so mid-drag widths are skipped and the resting width is
  the one claimed. Cancel any pending refit on unmount.
- A re-entrancy guard so a `fit()` performed by the scheduler cannot itself schedule another refit
  through the observer it triggered.
- Skip the refit entirely when the panel box is 0×0 (hidden). This is currently harmless by accident
  — `proposeDimensions()` returns `undefined` and `fit()` early-returns — but making it explicit
  avoids a pointless forced layout per hidden panel on every workspace-wide relayout, and every open
  terminal tab in every workspace stays mounted (`TabPanelHost`), so that cost is multiplied.
- The claim path is unchanged: the coalesced `fit()` still reaches the wire only through task-003's
  `claimSize` dedupe.

## Out of scope
- Changing the daemon's own 4 ms output coalescing (`terminal-manager.ts:266`) — unrelated and
  already correct.
- Debouncing anything other than refit/resize.

## Acceptance criteria
- [ ] A one-second pane-divider drag produces **one** `Resize` frame at rest (observed in devtools WS
      frames), not one per intermediate width, and the final size matches the resting grid.
- [ ] A window resize behaves the same.
- [ ] No "ResizeObserver loop completed with undelivered notifications" warning appears in the console
      during or after a drag.
- [ ] The terminal does not visibly stutter/flicker during a drag; the shell redraws once at the end.
- [ ] A hidden panel performs no `fit()` at all on an unrelated layout change.
- [ ] A pending refit scheduled just before a tab close does not run after unmount (no "write to
      disposed terminal" error).
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- Build/typecheck/lint/tests: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Manual, against `npm start`, with the devtools WS frame list filtered to binary frames:
  1. Slowly drag a divider across a wide range for ~2 s → count the `Resize` frames: one.
  2. `stty size` after the drag → matches.
  3. Resize the browser window repeatedly → same.
  4. Open a terminal, split several times, close panes rapidly → no console errors, no stray frames.
  5. With three terminal tabs open in two workspaces, drag a divider in the visible workspace → only
     the visible terminals refit (verify via a temporary log or by confirming no console warnings and
     no extra frames from the hidden slots).

## Notes
`requestAnimationFrame` does not fire in a hidden tab, so a refit requested while the browser tab is
backgrounded must not be lost — either fall back to a timer or re-request on the visibility
transition. The existing `isVisible` effect already covers the panel-level hidden→visible case; this
is the *browser-tab*-level one, and `sprint-050`'s worker-timer work exists precisely because
background-tab timers are throttled, so do not assume a `setTimeout` fires promptly there.
