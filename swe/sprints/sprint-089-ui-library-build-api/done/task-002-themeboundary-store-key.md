# Task 002 — `ThemeBoundary`: optional `store` (default `localStorageKvStore`) + configurable `storageKey`

- **Sprint:** sprint-089-ui-library-build-api
- **Status:** done
- **Type:** feature
- **Area:** packages/ui-library/src/theme
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
A consumer can render `<ThemeBoundary>` with no props; a second app on the same origin can isolate its appearance settings via `storageKey`.

## Context / why
D13, D15. Existing web-client users must keep their saved settings: default key stays `pi-studio-appearance`, JSON shape unchanged.

## Scope references
- `swe/grills/ui-library.md` D13, D15; AC5; § Data & state
- `packages/ui-library/src/theme/ThemeBoundary.tsx`, `appearance-store.ts` (+ `appearance-store.test.ts`)
- `packages/web-client/src/providers/AppProviders.tsx`

## What to build
- `createAppearanceController(store, brandConfig?, options?: { storageKey?: string })` — default key `pi-studio-appearance`.
- `ThemeBoundaryProps.store?` defaults to `localStorageKvStore`; new `storageKey?` passed through.
- web-client `AppProviders` drops the explicit store (uses default).

## Out of scope
- Brand validation (t003).

## Acceptance criteria
- [x] AC5: with defaults a pre-existing `pi-studio-appearance` value is read and applied; with `storageKey: "x"` that key is neither read nor written (unit tests with an in-memory `KeyValueStore`).
- [x] Existing appearance-store tests pass unchanged.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
