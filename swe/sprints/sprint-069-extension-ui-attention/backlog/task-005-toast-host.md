# Task 005 — Build the toast host (the primitive that was specified but never implemented)

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / components/primitives, ui
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
Ship the app's first toast surface: a store, a top-anchored portalled viewport, hover-pause, sticky
support, and a new `warning` variant — so `notify` (task-006) has somewhere to render.

## Context / why
Planning found this and it changes the sprint's shape: **there is no toast UI in this app.**
`packages/web-client/src/ui/toast.ts` exists and is complete as *logic* — `ToastVariant`,
`ToastOptions`, `ToastEntry`, `buildToastEntry`, `copiedToast`, `errorToast`, `remainingMs` with
hover-pause accounting, `DEFAULT_TOAST_DURATION_MS` — and it has **zero importers**. No host, no
store, no component, nothing named `Toast*`/`Snackbar*`/`Notification*` anywhere in `features/`,
`routes/` or `components/`. `ui-components.md` § Feedback specifies the host in detail; it was never
built.

So § 11's notify toast is not "add a variant to the existing toast" — it is the toast surface itself.
Getting that wrong in sizing is why this is its own task, ahead of the thing that needs it.

Because the primitive is app-wide, it is built to the existing catalog spec rather than shaped around
this one caller — `copied(label?)` and `error(message)` already exist as factories in `toast.ts` and
must work, even though nothing calls them yet.

## Scope references
- `swe/features/ui-components.md` § Feedback (the host contract: `show(content, opts)`, `copied`,
  `error`; single top-anchored viewport; opacity + slide; hover-pause on web; portal into the overlay
  root; variants) and § the platform table's "Toast on web" row
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 01 (`surface1` is the toast
  surface; `statusWarning` 18% is the warning toast rail; `statusDanger` is the error toast only),
  § 11 (level treatments), § 13 (reduced motion: toasts appear and leave without sliding)
- `packages/web-client/src/ui/toast.ts` (all existing logic — reuse, do not rewrite)
- `packages/web-client/src/ui/index.ts` (barrel)
- `packages/web-client/src/components/primitives/Dialog.tsx` (portal/overlay-root precedent)
- `packages/web-client/src/hooks/use-shortcuts.ts` (Esc handling this must join, per
  `toast.ts`'s own header comment naming an Esc-stack)

## What to build
- Add `"warning"` to `ToastVariant` and a variant→token mapping (`default`/`success`/`error`/
  `warning`), following `StatusBadge`'s `statusBadgeTokens` shape rather than inventing a new one.
- A store holding `ToastEntry[]` with `show`/`copied`/`error` actions and dismissal, driving timers off
  the existing `remainingMs` + hover-pause logic. Sticky (`durationMs: null`) entries never auto-close.
- A single viewport component, top-anchored, portalled into the overlay root, rendering the stack with
  the § 01 surface and per-variant rail. Opacity + slide in/out; under `prefers-reduced-motion` they
  appear and leave without sliding.
- Stacking per § 11: at most **three toasts visible at once**; further toasts queue and surface as
  visible slots free up. The queue lives in the store so it is testable under Node.
- Hover pauses the dismiss timer (web desktop) via the existing paused-remaining logic.
- Esc dismisses the top toast, joining the existing Esc precedence without stealing Esc from dialogs
  or (sprint-068's) armed question cards.
- Mount the viewport once at the app shell level.

## Out of scope
- `notify` routing and its copy (task-006) — this task is the surface only.
- The Android native-toast delegation path (`nativeAndroid` in `ToastOptions`): keep the option in the
  type, do not implement a native bridge in the browser client.
- Retrofitting existing "copied"/error feedback across the app to use toasts. The factories must work;
  finding every call site that *should* now toast is not this sprint's job.

## Acceptance criteria
- [ ] `show`, `copied` and `error` all render a toast; `error` and `warning` carry their § 01 rails.
- [ ] Default duration auto-dismisses; `durationMs: null` stays until dismissed.
- [ ] Hovering a toast freezes its remaining time; leaving resumes it.
- [ ] At most three toasts render at once; a fourth queues and appears when one dismisses.
- [ ] Esc dismisses the top toast; with a dialog open, Esc closes the dialog first (existing
      precedence unchanged).
- [ ] Reduced motion: no slide, no lingering exit.
- [ ] Nothing renders when no toast is active — no reserved space, no empty container in layout.
- [ ] All CSS from tokens; no raw px/hex.

## Test / verification plan
- Tests: `toast.ts`'s pure logic currently has **no tests** — cover it together with the new
  store: queueing and the three-visible cap, sticky vs timed dismissal, hover-pause via
  `remainingMs`, and the variant→token mapping. Run
  `npx vitest run packages/web-client/src/ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Nothing user-triggerable ships in this task alone (no caller exists yet), so verification is via
task-006's `#ui notify` recipes. If you want to see it in isolation before then, the implementer should
note a temporary way to fire one in the summary and remove it before the sprint closes.

## Notes
`toast.ts`'s existing `remainingMs(entry, pausedRemaining, now)` signature already anticipates the
hover-pause design — build the store around it rather than re-deriving timing, and it stays testable
under Node.
