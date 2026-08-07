# Task 004 — Coalesce refits and resize claims; guard the ResizeObserver feedback loop — Summary

- **Sprint:** sprint-052-terminal-sizing
- **Completed:** 2026-08-06
- **Status:** done

## What was implemented
- A single scheduled-refit seam in `TerminalPanel` — component-scope `performRefit`/`requestRefit`
  functions (plain, not memoized: they close over nothing but refs, so a fresh identity every
  render is harmless) backed by three refs:
  - `refitTimerRef` — the ~60ms trailing debounce. `requestRefit()` clears any pending timer and
    reschedules, so a burst of calls (a drag) only ever lands the LAST one.
  - `refitRafRef` — once the debounce elapses, the actual `fit()` is aligned to a paint frame via
    `requestAnimationFrame`, and a second `requestRefit()` call arriving while that frame is
    already scheduled is a no-op (checked before scheduling another).
  - `isFittingRef` — the re-entrancy guard. Set `true` immediately before `performRefit` calls
    `fitAddon.fit()`, held through one more `requestAnimationFrame` tick (long enough for a
    `fit()`-induced box perturbation, if any, to be delivered by `ResizeObserver`), then cleared.
- Both call sites the task named now go through this seam instead of fitting directly:
  - The `ResizeObserver` callback: skips entirely (no debounce even scheduled) when
    `isFittingRef.current` is true, or when the delivered entry's own `contentRect` is 0×0 (hidden
    panel) — read directly off the `ResizeObserverEntry`, not a separate `getBoundingClientRect()`
    call, so a hidden panel costs no forced layout. Otherwise calls `requestRefit()`.
  - The `isVisible` effect (hidden→visible transition): now calls `requestRefit()` instead of
    `fitAddonRef.current?.fit()` directly, so a tab-switch adjacent to a layout gesture shares the
    same coalescing instead of adding a second immediate fit.
- Cleanup (emulator effect's unmount): cancels both the pending timer and any scheduled rAF
  (`window.clearTimeout` / `cancelAnimationFrame`), so a refit scheduled just before a tab closes
  never fires against a disposed terminal.
- **Deliberately left untouched (in scope per the task's own boundary):** the focus handler
  (`handleFocus`) still calls `fitAddon.fit()` synchronously, not through the scheduler — it is a
  discrete one-shot action (a click), not a continuous gesture, so routing it through a 60ms debounce
  would only add latency to "click to claim" with no coalescing benefit. The task's "What to build"
  section names only "observer callbacks and the visibility effect."
- The claim path is unchanged: `performRefit`'s `fitAddon.fit()` still only reaches the wire through
  task-003's `terminal.onResize` → `claimSize` seam, which still dedupes.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/terminal/TerminalPanel.tsx` | modified — `performRefit`/`requestRefit` scheduler, `refitTimerRef`/`refitRafRef`/`isFittingRef`, `ResizeObserver` callback coalesced + hidden-entry skip + re-entrancy skip, `isVisible` effect routed through `requestRefit`, cleanup cancels pending timer/rAF |

No test file changes: the scheduler is pure timing/DOM-event glue (debounce, rAF, `ResizeObserver`
entry inspection) with no decidable branch logic beyond what task-002's `terminal-size.ts` already
unit-tests (`isMeasurable`/`shouldClaimOnChange`/`shouldClaimOnFocus`, untouched by this task) —
proven live instead, per the acceptance criteria's own manual-verification framing.

## How it satisfies the scope
- `terminals.md` § PTY size ownership ("Resize frames SHOULD be coalesced client-side — one frame
  once the size settles, not one per animation frame") — a 9-step, ~360ms simulated window-resize
  drag produced exactly **one** `Resize` frame, at the resting size, both live-tested runs (see
  below).
- The `ResizeObserver` → `fit()` → observed-size-change → `ResizeObserver` re-entrancy loop named in
  the task's Background is broken two ways: the observer callback's own synchronous body no longer
  performs a same-frame DOM-affecting `fit()` (it only ever schedules), which eliminates the
  same-frame trigger the "loop completed with undelivered notifications" browser warning fires on;
  and `isFittingRef` additionally skips a delayed echo notification arriving while the scheduler's
  own `fit()` is still settling.
- Hidden-panel skip is by construction from the `ResizeObserverEntry.contentRect`, not by the
  pre-existing accidental `proposeDimensions()`-returns-`undefined` behavior the task called out as
  "harmless by accident" — now explicit and avoids a forced-layout `getBoundingClientRect()` call on
  every hidden terminal tab on every workspace-wide relayout.

## Build & test results
```
$ npm run typecheck   (root, tsc -b)                         → exit 0
  NOTE: does NOT cover packages/web-client — root tsconfig.json's project references list stops at
  protocol/highlight/relay/client/server/cli. web-client is typechecked only via its own
  `build:web` (VITE_TARGET=web tsc -b), which IS exercised by `npm run build` below. A first pass
  of this task used a bare `number` type for `refitTimerRef` (matching plain-DOM `setTimeout`
  typing) — passed root typecheck but failed `npm run build`'s `build:web` step with
  `Type 'Timeout' is not assignable to type 'number'`: `web-client`'s own `tsc -b` pulls in
  `packages/client`'s composite project-reference output, and something in that graph carries an
  ambient `@types/node` global augmentation that overrides `setTimeout`'s return type for the whole
  program despite web-client's own tsconfig setting `"types": []`. Fixed by following this
  codebase's existing convention for this exact conflict (`files-changed.ts`'s
  `ReturnType<typeof setTimeout>`, `FileExplorer.tsx`'s `window.setTimeout`/`window.clearTimeout`
  to force DOM-overload resolution) — used the `window.`-prefixed form since it needs no extra type
  alias. Re-ran `npm run build` clean after the fix (see below).
$ npx oxlint packages/web-client/src/features/terminal/TerminalPanel.tsx   → exit 0, no output
$ npx oxfmt --check packages/web-client/src/features/terminal/TerminalPanel.tsx → correctly formatted
$ npm run build       (root, all packages incl. build:web)   → ✓ (web-client built in 7.46s)
$ npm run lint         (root, oxlint)                         → exit 0
$ npm test              (root, vitest)                         → 138 test files, 1541 tests passed
                                                                  (unchanged — no new test files)
```

## Acceptance criteria
- [x] A one-second pane-divider drag / window resize produces **one** `Resize` frame at rest, not
      one per intermediate width, and the final size matches the resting grid — verified live twice
      (once before the timer-type fix, once after, against the actual daemon): a 9-step viewport
      resize from 1280px → 1600px (and separately → 1680px) over ~360ms, with `WebSocket.prototype
      .send` instrumented client-side to capture every binary frame whose first byte is the
      `Resize` opcode (`0x03`). Both runs produced exactly one captured frame, and `pi-studio
      terminal ls` (daemon-side, out-of-band) confirmed the PTY's `cols`/`rows` matched the resting
      viewport exactly (`128×42` and `138×42` respectively) — not an intermediate width.
- [x] A window resize behaves the same — the drag simulation above IS a window resize (viewport
      width stepped through 9 values); pane-divider drags are not separately exercised (no split
      pane / divider UI element was driven in this session) but go through the identical
      `ResizeObserver` → `requestRefit` path with no divider-specific branch, so this is a single
      code path already covered.
- [x] No "ResizeObserver loop completed with undelivered notifications" warning appeared in the
      console during or after either drag — `console.warn`/`console.error` were both patched to
      capture every call during the test window; zero warnings both runs.
- [~] The terminal does not visibly stutter/flicker during a drag — not independently verified
      (headless browser, no visual/frame-rate capture in this session); the single-frame-at-rest
      result is a strong proxy (the flicker source named in the task's Background is the per-frame
      `SIGWINCH`/prompt-redraw the coalescing directly eliminates) but this specific visual claim is
      unproven here.
- [x] A hidden panel performs no `fit()` at all on an unrelated layout change — verified live:
      after switching the active tab away from `terminal-1` (making its panel `display:none`-hidden
      per `TabPanelHost`'s persistent-DOM model) and repeating the same 9-step resize drag, **zero**
      `Resize` frames were captured for the hidden slot.
- [x] A pending refit scheduled just before a tab close does not run after unmount (no "write to
      disposed terminal" error) — verified live: triggered a viewport resize (scheduling a ~60ms
      pending refit) then immediately clicked the tab's close button before the debounce could
      elapse. Zero console warnings/errors after the close; the tab-strip confirmed the terminal
      tab was gone.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass — see Build & test
      results above (after the timer-type fix `npm run build` passes clean end-to-end, including
      the `build:web` step root `typecheck` does not cover).

## Follow-ups / TODO(verify)
- The visible-stutter/no-flicker criterion is a UX observation this session's headless-browser
  instrumentation cannot directly capture; task-006 (dedicated E2E task, interactive browser) should
  do a real visual pass on a divider drag.
- A literal pane-divider drag (as opposed to a window resize) was not driven in this session — no
  split-pane UI was present in the test workspace. The code path is identical (both go through the
  same `ResizeObserver` on the panel's own box), so this is low-risk, but task-006's split-pane
  matrix should include a divider-drag-specific pass to close it out.
