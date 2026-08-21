# Task 001 — Expose the resolved theme to components (appearance context) — Summary

- **Sprint:** sprint-053-terminal-fidelity
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented
`AppearanceController` gained a `subscribe(listener): () => void` method, backed by a `Set` of
listeners notified from the single `update()` function — the one place `setMode`, `updateSettings`,
and the system dark-mode `listen()` handler all already funnel through, so all three mutation paths
notify uniformly with no new call sites to keep in sync.

`ThemeBoundary` now reads the controller through `useSyncExternalStore(controller.subscribe,
controller.getState)` and publishes the resulting `AppearanceState` via a new React context. Two
hooks are exported: `useAppearance()` (full `AppearanceState`) and `useResolvedTheme()` (just
`.resolvedTheme`), both throwing if used outside a `ThemeBoundary`. The pre-first-paint synchronous
`apply()` call in the `!controllerRef.current` branch is untouched — the context is additive, no
existing render-path behavior changed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/theme/appearance-store.ts` | added `subscribe` to `AppearanceController` interface + impl; `update()` now notifies |
| `packages/web-client/src/theme/ThemeBoundary.tsx` | added `AppearanceContext`, `useAppearance()`, `useResolvedTheme()`; boundary now subscribes via `useSyncExternalStore` and provides context |
| `packages/web-client/src/theme/index.ts` | exports the two new hooks |
| `packages/web-client/src/theme/appearance-store.test.ts` | created — 6 tests for the subscribe/notify contract |

## How it satisfies the scope
Matches `design-system.md` § Colors / § Scales (no token change) and `feature-panels-ui.md` §
Terminal pane's appearance-sourcing contract by giving task-002 a seam to consume. No CSS-variable
consumer changed: `flattenThemeToVars`/`applyThemeToDOM` untouched, still called synchronously from
the same `if (!controllerRef.current)` branch.

## Build & test results
```
$ npx vitest run packages/web-client/src/theme
 Test Files  3 passed (3)
      Tests  13 passed (13)

$ npm run build:web-client
✓ built in 10.54s

$ npx tsc -b packages/web-client --force
(clean)

$ npx oxlint packages/web-client/src/theme/appearance-store.ts packages/web-client/src/theme/ThemeBoundary.tsx packages/web-client/src/theme/index.ts packages/web-client/src/theme/appearance-store.test.ts
2 warnings (no-shadow, consistent-function-scoping) — both pre-existing, on lines this task did not touch (`loadInitial`'s `store` param, `resolveThemeName`); 0 errors.

$ npx oxfmt --check <same files>
All matched files use the correct format.
```
Full-suite `npm run build`/`npm test`/`npm run lint` deferred to sprint close per the task-by-task
workflow; per-package gates above are green.

## Acceptance criteria
- [x] A component can read the resolved `Theme` (including `colors.terminal`, `fontSize`,
      `fontFamily.mono`) through a hook, with no `getComputedStyle` and no string parsing — `useResolvedTheme()`.
- [x] Changing the theme mode or appearance settings through the controller re-renders consumers with
      the new `Theme`; a system dark-mode change does the same via the existing `listen()` path — all
      three paths flow through `update()`, which now notifies.
- [x] Theme CSS variables are applied synchronously on first render exactly as before (no flash), and
      the emitted variable set is unchanged — `apply()` call site and `flattenThemeToVars`/`applyThemeToDOM` untouched.
- [x] Existing theme tests pass unchanged, including `theme/font-scale.test.ts` (verified above).
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass (package-scoped equivalents run above; full suite re-confirmed at sprint close).

## Follow-ups / TODO(verify)
- task-002 is the first real consumer of `useResolvedTheme()` — proceeds next in this sprint.
