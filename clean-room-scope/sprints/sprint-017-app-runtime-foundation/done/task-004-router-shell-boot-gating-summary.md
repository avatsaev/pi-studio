# Task 004 — Router shell, boot resolver & route gating — Summary

- **Sprint:** sprint-017-app-runtime-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Created the `react-router` data router tree mapping the full sprint-013 route grammar (20+ routes
including `/welcome`, `/pair-scan`, `/new`, `/open-project`, `/sessions`, `/schedules`,
`/settings/*`, `/h/:serverId/*`, `/h/:serverId/workspace/:workspaceId`, etc.). Built the `AppShell`
layout with header/sidebar/content/portal slots (structural placeholders for sprint-018). Created
`BootGate` component consuming the sprint-013 `resolveBootRoute` model (splash → welcome/host/
workspace). Wired everything into `app.tsx` with providers + RouterProvider.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/router/routes.tsx` | created — route tree with createAppRouter |
| `packages/app/src/router/AppShell.tsx` | created — layout shell with slots |
| `packages/app/src/router/PlaceholderScreen.tsx` | created — dev placeholder with params display |
| `packages/app/src/router/BootGate.tsx` | created — boot resolver navigation gate |
| `packages/app/src/router/index.ts` | created — public exports |
| `packages/app/src/router/router.test.ts` | created — 14 tests |
| `packages/app/src/app.tsx` | modified — wires providers + RouterProvider |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
✓ success

$ npx vitest run
Test Files  91 passed (91)
     Tests  1030 passed (1030)

$ npm --workspace @av-pi-studio/app run build:web
✓ 110 modules transformed, 387 kB JS (built in 780ms)
```

## Acceptance criteria
- [x] All grammar routes resolve to a mounted (placeholder) screen with typed params.
- [x] The boot resolver routes first paint correctly for: no hosts → `/welcome`; saved host → host
      home; saved workspace deep-link → workspace route.
- [x] `?open=` and agent/workspace deep-link params reach the target route unchanged (tested via
      parseRoute round-trip in router.test.ts).

## Follow-ups / TODO(verify)
- BootGate `GAVE_UP_TIMEOUT_MS` (5000ms) — may need tuning for perceived startup speed.
- Desktop-only routes (none yet; will add when sprint-024 Electron shell exists).
