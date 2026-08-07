# Task 002 — Styling-engine conventions, platform gating, overlay/portal infra — Summary

- **Sprint:** sprint-012-ui-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Platform-gating constants and helpers, breakpoints, layout constants, hover-to-show rule, and the
positioning engine for anchored overlays.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/platform/breakpoints.ts` | created — breakpoints, `getBreakpoint`, `isCompactFormFactor`, all layout constants, `WINDOW_CHROME` |
| `packages/app/src/platform/gating.ts` | created — `isWeb`, `isNative`, `getIsElectron()`, `supportsDesktopPaneSplits()`, styling-engine rules doc |
| `packages/app/src/platform/hover.ts` | created — `hoverVisible`, `assertPointerEventsWebOnly` |
| `packages/app/src/platform/overlay.ts` | created — `resolvePosition` (flip/align/clamp), `resolveOverlayMode`, `Z_ORDER` |
| `packages/app/src/platform/index.ts` | created — barrel re-export |
| `packages/app/src/platform/platform.test.ts` | created — 41 tests |
| `packages/app/src/index.ts` | modified — re-exports platform index |

## How it satisfies the scope

- **Breakpoints** exact min-widths per doc table: xs=0, sm=576, md=768, lg=992, xl=1200.
- **`isCompactFormFactor`** — flips at the sm→md boundary (768px); xs and sm are compact.
- **Layout constants** — all nine documented values including `WINDOW_CHROME` macOS/Windows-Linux
  reserves.
- **Platform gating** — `isWeb`/`isNative`/`getIsElectron()`/`supportsDesktopPaneSplits()` with the
  `__piStudioElectron` preload marker; Metro platform-extension convention documented in `STYLING_ENGINE_RULES`.
- **Hover-to-show** — `hoverVisible = isHovered || isNative || isCompact`; pointer-event web-only guard.
- **Positioning engine** — preferred-side, auto-flip (opposite side when insufficient room), start/center/end
  alignment, 8px edge clamping, Android status-bar offset; `resolveOverlayMode` (compact→bottom-sheet);
  `Z_ORDER` (modal<toast).

## Build & test results

```
$ npx vitest run packages/app/src/platform/platform.test.ts
 ✓ packages/app/src/platform/platform.test.ts (41 tests) 4ms
 Test Files  1 passed (1)
      Tests  41 passed (41)
```

## Acceptance criteria

- [x] `isCompactFormFactor` flips at sm→md boundary; `resolveOverlayMode` returns `bottom-sheet`
      on compact — both verified.
- [x] Positioning routine flips/clamps near screen edges with 8px padding and Android offset — verified
      by 9 `resolvePosition` cases.
- [x] Hover-revealed controls always visible on native/compact, hover-gated on web — full 8-row truth
      table tested.
- [x] Inline-geometry seam design documented via the overlay module's `resolvePosition` + the
      `STYLING_ENGINE_RULES` constant pointing to the spec.

## Follow-ups / TODO(verify)

- `getIsElectron()` Electron detection relies on `__piStudioElectron` on `window` — the preload bridge
  that sets this is built in sprint-018.
- `isWeb`/`isNative` are evaluated at module init; Metro `.web.ts`/`.native.ts` extensions will provide
  true platform-split implementations in the production build.
