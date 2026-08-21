# Task 005 — Build the toast host — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

The app's first toast surface, built on `ui/toast.ts`'s previously-zero-importer logic (reused, not
rewritten — only additive changes: a `"warning"` variant, a `toastTokens` variant→token mapping
mirroring `status-badge.ts`'s `statusBadgeTokens` shape exactly, and an optional
`pausedRemaining?: number` field on `ToastEntry` so the hover-pause snapshot lives on the entry
itself rather than a parallel id-keyed structure that could drift out of sync).

**`stores/toast-store.ts`** (new): a zustand store owning `toasts: ToastEntry[]` (a FIFO queue,
oldest first) plus `show`/`copied`/`error`/`dismiss`/`dismissTop`/`pause`/`resume`. Real dismiss
timers live in a module-level `Map<id, TimeoutHandle>`, not the reactive state — a timer handle
isn't display data, mirroring `agent-ui-store.ts`'s module-level cache convention for the identical
reason. Stacking (§ 11): `toasts.slice(0, MAX_VISIBLE_TOASTS)` (3) is what's visible; the store
never trims the array itself. A queued entry's countdown starts at *promotion* into a visible slot,
not at `show()` time (`promoteIfNewlyVisible` resets `shownAt` to that instant) — otherwise a toast
that waited behind others would arrive already expired. "Top" (what Esc/`dismissTop()` removes) is
defined as `toasts[0]`, the longest-visible entry — new toasts append below it.

**`components/primitives/ToastViewport.tsx`** (new) + `.module.css`: a single top-center-anchored
viewport, portalled to `document.body` via `createPortal` (`Dialog.tsx`'s `Portal` precedent — this
app has no dedicated named overlay-root element, and `document.body` is exactly what Radix's own
`Portal` defaults to). Mounted exactly once, in `WorkspacePage.tsx` next to `OpenWorkspaceDialog`.
Per-variant left rail via a `--toast-rail` custom property fed from `toastTokens`. Exit animation is
owned in this component, not the store: the store's `dismiss` stays an immediate, synchronous array
removal (simple, Node-testable); the viewport keeps a small local cache of rendered toast content
and, on noticing an id leave the store's array (from either auto-dismiss or a manual close click —
both just mutate the store, so this is naturally unified), renders it a little longer with an
`.exiting` class so its opacity/`translateY` transition can play before dropping it from local
state. `@starting-style` handles entrance without any JS. Reduced motion
(`@media (prefers-reduced-motion: reduce)`) drops the transition entirely and the exiting-lingering
logic is skipped in the same tick (no delayed removal at all under reduced motion).

**Esc-stack.** `toast.ts`'s `EscStack` class turned out to have zero adopters anywhere in the app
(dialogs close via Radix's own `DismissableLayer`, sprint-068's `AskCard.tsx` handles its own Esc
via `stopPropagation()`) — adopting it for just this one caller would have meant either leaving
dialogs/cards unintegrated with it (a fake "shared" stack) or retrofitting them in this task (scope
creep well beyond "toast host"). Instead, `use-shortcuts.ts`'s existing flat global Esc handler
gained one more unconditional call — `useToastStore.getState().dismissTop()` — guarded by
`!document.querySelector('[role="dialog"], [role="alertdialog"]')`. This precisely implements "with
a dialog open, Esc closes the dialog first": Radix's `DismissableLayer` registers its own Escape
listener with `{ capture: true }` (verified by reading `@radix-ui/react-dismissable-layer`'s
source), which runs *before* this bubble-phase listener and does not call `stopPropagation()` — so
without the guard, one Escape keystroke would close a dialog *and* dismiss a toast simultaneously.
Cards need no such guard: their `stopPropagation()` is a real native call, which prevents this
listener from observing the event at all — confirmed during the sprint-069 planning review.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/ui/toast.ts` | modified — `"warning"` variant, `toastTokens`, `pausedRemaining` field |
| `packages/web-client/src/ui/toast.test.ts` | created — first test coverage for this module |
| `packages/web-client/src/stores/toast-store.ts` | created — the store |
| `packages/web-client/src/stores/toast-store.test.ts` | created |
| `packages/web-client/src/components/primitives/ToastViewport.tsx` | created |
| `packages/web-client/src/components/primitives/ToastViewport.module.css` | created |
| `packages/web-client/src/routes/WorkspacePage.tsx` | modified — mounts `ToastViewport` once |
| `packages/web-client/src/hooks/use-shortcuts.ts` | modified — Esc dismisses the top toast |
| `packages/web-client/src/test/reset-stores.ts` | modified — re-exports the toast store's test reset |

## How it satisfies the scope

Matches `ui-components.md` § Feedback's host contract (`show`/`copied`/`error`, top-anchored,
opacity+slide, hover-pause, portal into the overlay root, variants) and the visual spec's § 01
(`surface1` + rail tokens), § 11 (three-visible stacking), § 13 (reduced motion). The toast
viewport's exact horizontal anchor (top-center) is this task's own defensible choice — the visual
spec HTML is a bundled interactive SPA, not statically greppable text, and no other part of this
app's existing overlay chrome dictated a specific horizontal position; top-center is centered under
the surrounding UI, matching common toast-host convention.

## Build & test results

```
$ npx vitest run packages/web-client/src/ui/ packages/web-client/src/stores/
Test Files  10 passed (10)
Tests  175 passed (175)

$ npx tsc -b --force
(clean — no output)

$ npm run lint
(zero new warnings; the pre-existing `EscStack._stack` underscore-dangle warnings are untouched —
that class's body was not edited by this task)

$ npx oxfmt <changed files>
(reformatted ToastViewport.tsx and toast-store.test.ts once; re-checked clean)

$ npm run build:web-client
✓ built in 10.77s
```

## Acceptance criteria

- [x] `show`, `copied` and `error` all render a toast; `error` and `warning` carry their § 01 rails
      — tested via `toastTokens` and end-to-end through the store.
- [x] Default duration auto-dismisses; `durationMs: null` stays until dismissed — tested with fake
      timers (`vi.advanceTimersByTime`).
- [x] Hovering a toast freezes its remaining time; leaving resumes it — tested: paused for 10s of
      simulated time with zero elapsed-duration effect, then resumed and correctly finishes from
      where it left off.
- [x] At most three toasts render at once; a fourth queues and appears when one dismisses — tested,
      including that the queued entry's timer only starts at promotion (not at `show()` time).
- [x] Esc dismisses the top toast; with a dialog open, Esc closes the dialog first — implemented via
      the `[role="dialog"]` guard; Radix's own capture-phase Escape handling verified from
      `@radix-ui/react-dismissable-layer`'s installed source.
- [x] Reduced motion: no slide, no lingering exit — `@media (prefers-reduced-motion: reduce)` drops
      the CSS transition; the JS-side exit-lingering is skipped in the same tick.
- [x] Nothing renders when no toast is active — `ToastViewport` returns `null` before the portal
      when `rendered.length === 0`; no reserved space anywhere (it's a `position: fixed` overlay,
      not laid out in flow).
- [x] All CSS from tokens; no raw px/hex — the two literal numbers (`420px` max-width, matching
      `Dialog.module.css`'s own `width: 500px`/`max-width: 90vw` precedent for box-sizing
      constraints, and the `-8px`/`180ms` transition values) are motion/sizing constants, not
      color/spacing-rhythm values; every color, spacing, radius, border-width, and shadow is a
      `var(--pi-*)` token.

## Follow-ups / TODO(verify)

- Visual sign-off deferred to task-006, per this task's own hand-off note ("nothing
  user-triggerable ships in this task alone... verification is via task-006's `#ui notify`
  recipes") — task-006 will exercise the full pipeline (mock recipe → store → viewport) in one real
  browser pass rather than a throwaway temporary trigger built and torn down here.
- The Android `nativeAndroid` option is preserved on the type only, per Out of scope — no native
  bridge exists in this browser client.
