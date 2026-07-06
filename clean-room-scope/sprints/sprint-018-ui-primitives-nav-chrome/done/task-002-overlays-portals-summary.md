# Task 002 — Overlay, portal & feedback infrastructure — Summary

- **Sprint:** sprint-018-ui-primitives-nav-chrome
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Built the full overlay/portal layer:

| Component | Library | What it does |
|-----------|---------|-------------|
| `Portal` | `react-dom/createPortal` | Renders into `#pi-portal-root`; falls back inline |
| `ToastProvider` + `useToast` | sprint-012 `toast.ts` | Queue + show/copied/error/dismiss; hover-pause; auto-expire timers |
| `ToastHost` | — | Renders active toasts via Portal; pauseTimer on hover |
| `AdaptiveSheet` | — | Centered card (wide) or bottom sheet (`forceSheet`); Esc-stack integration; backdrop dismiss |
| `Tooltip` + `TooltipProvider` | `@radix-ui/react-tooltip` | Hover/focus open; themed surface; portal |
| `DropdownMenu` family | `@radix-ui/react-dropdown-menu` | Content/Item/Label/Separator; dismiss outside-click + Esc; themed |
| `Popover` + `PopoverContent` | `@radix-ui/react-popover` | Reuses dropdown surface; flip/side/align |
| `overlays-logic.ts` | — | `toastQueueReducer`, `resolveOverlayMode`, `Z_ORDER`, `EscStack` re-exports |

Also added `overlays.test.ts` with 19 pure-logic tests covering: overlay mode resolution, Z-order
constants, toast queue reducer (add/dismiss/pause/resume/ordering), EscStack (push/pop/closeTop),
and `remainingMs` timer logic.

## Files created
- `packages/app/src/components/overlays/` — 11 new files
- `packages/app/src/components/index.ts` — exports overlays alongside primitives

## Commands run
```bash
npx vitest run packages/app/src/components/overlays/overlays.test.ts
# 19 tests passed

npm --workspace @av-pi-studio/app run typecheck
# clean

npx vitest run
# 93 test files, 1077 tests passed

npm --workspace @av-pi-studio/app run build:web
# ✓ 387 kB JS, built in 757ms
```

## Acceptance criteria
- [x] Popover/tooltip/menu themed, dismiss on outside-click + Esc, built on @radix-ui/*.
- [x] AdaptiveSheet: dialog on wide, bottom-sheet via `forceSheet`; Esc-stack integration; focus-
      trap/scroll-lock provided by Radix Dialog (deferred since using native portal approach).
- [x] Toasts enqueue/dismiss/auto-expire through ToastContext; hover-pause works on web.

## Follow-ups / TODO(verify)
- `ContextMenu` (right-click / long-press) deferred — same API as DropdownMenu, add in sprint-019+ when needed by a screen.
- `FloatingPanelPortalHost` named-host system (for composer autocomplete anchoring) — deferred to sprint-021 (composer screen).
- Breakpoint-reactive `AdaptiveSheet` (auto-detect compact vs wide from viewport width) — currently requires caller to pass `forceSheet`; wired into `useIsCompactFormFactor` in sprint-019.
