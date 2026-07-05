# Task 004 — Overlays, navigation chrome, feedback primitives — Summary

- **Sprint:** sprint-012-ui-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Toast API + timer state + hover-pause logic, Esc-stack for modal/sheet close ordering,
AgentStatusDot state-bucket→color mapping, and ScreenHeader layout-padding computation.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/ui/toast.ts` | created — `ToastEntry`, `buildToastEntry`, `copiedToast`, `errorToast`, `remainingMs`, `EscStack` |
| `packages/app/src/ui/status-dot.ts` | created — `statusDotColor` (state-bucket→token), `STATUS_DOT_SIZE` |
| `packages/app/src/ui/screen-header.ts` | created — `headerPadding` (window-control reserve computation), header height constants |
| `packages/app/src/ui/overlays.test.ts` | created — 33 tests |
| `packages/app/src/ui/index.ts` | modified — re-exports new modules |

## How it satisfies the scope

- **Toast API** — `show/copied/error` convenience factories; `default/success/error` variants; sticky
  toasts (durationMs=null); `remainingMs` computes dismiss timer accounting for hover-pause freeze.
  Default duration 2200ms per spec.
- **EscStack** — shared key-stack; `closeTop()` calls and pops the topmost `close()` fn; used by
  modals + sheets for correct Esc ordering; duplicates handled via `findLastIndex`.
- **AgentStatusDot** — all 7 status values mapped to color tokens; `requiresAttention` overrides with
  reason (permission/error/finished); null/missing → null (render nothing); `showInactive` gate for
  idle/archived.
- **ScreenHeader** — macOS traffic-light (78px left) vs Windows/Linux (140px right) window-control
  padding; mobile height 56 / desktop height 48; zero padding on non-desktop.

## Build & test results

```
$ npx vitest run packages/app/src/ui/overlays.test.ts
 ✓ packages/app/src/ui/overlays.test.ts (33 tests) 4ms
 Test Files  1 passed (1)
      Tests  33 passed (33)
```

## Acceptance criteria

- [x] Positioning reuse: `resolvePosition` (from task-002) is shared; flip/align/clamp verified in 9 cases.
- [x] Toast API: `copied/error/sticky` variants + `remainingMs` hover-pause logic tested.
- [x] Status-dot bucket→color tested for all status values + attention overrides.
- [x] Esc-stack topmost close + pop by id tested.
- [x] Header padding: macOS left reserve (78px) / Windows right reserve (140px), mobile/desktop heights.

## Follow-ups / TODO(verify)

- Full overlay rendering (FloatingSurface, Tooltip, DropdownMenu, AdaptiveModalSheet, ContextMenu)
  requires the RN/web runtime and is deferred.
- Toast viewport animation and web portal wiring are deferred to runtime.
- Android native-toast delegation is deferred to the native runtime.
