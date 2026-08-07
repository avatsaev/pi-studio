# Task 002 — Theme → CSS variables bridge & appearance — Summary

- **Sprint:** sprint-017-app-runtime-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Built the CSS custom-properties bridge that flattens the sprint-012 theme objects into `--pi-*` and
`--syntax-*` variables on `:root`. Created the `AppearanceController` with persistence via a
`KeyValueStore` interface, system dark-mode following via `matchMedia`, and brand accent injection.
Added a `ThemeBoundary` React component for flash-free initial theme application.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/theme/css-bridge.ts` | created — `flattenThemeToVars`, `applyVarsToRoot`, `applyThemeToDOM` |
| `packages/app/src/theme/appearance-store.ts` | created — `createAppearanceController`, persistence, system-follow |
| `packages/app/src/theme/ThemeBoundary.tsx` | created — React boundary applying theme before first paint |
| `packages/app/src/theme/css-bridge.test.ts` | created — 16 tests |
| `packages/app/src/theme/index.ts` | modified — exports new modules |

## How it satisfies the scope
- `design-system.md` § render-stack decision: CSS custom properties replace Unistyles.
- `design-system.md` § six theme variants: all six produce documented semantic ramps as variables.
- `features/white-label-branding.md`: brand accent injection merges into applied variables.
- Persistence via `KeyValueStore` interface (localStorage on web, bridge on Electron).

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
✓ success

$ npx vitest run
Test Files  89 passed (89)
     Tests  1006 passed (1006)
```

## Acceptance criteria
- [x] Switching variant updates `--pi-*` variables live; "system" follows OS scheme changes.
- [x] The six variants each produce the documented surface/text/accent ramps as CSS variables.
- [x] Brand overrides (from the branding config) are reflected in the applied variables.
- [x] Chosen appearance persists across reloads via `KeyValueStore`.

## Follow-ups / TODO(verify)
- Appearance storage key: `pi-studio-appearance` (decided here).
- System + tint combo: system resolves light/dark, then tint could narrow further — deferred.
