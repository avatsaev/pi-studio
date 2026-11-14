# Task 003 — Trim brand runtime to accent-only API; validate with warn + unbranded fallback

- **Sprint:** sprint-089-ui-library-build-api
- **Status:** done
- **Type:** feature
- **Area:** packages/ui-library/src/brand, theme
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The library's brand surface is `BrandConfigSchema`/`BrandConfig` (only `colors.accent` required), `resolveAccentColors`, `injectBrandAccent`; an invalid config warns once and renders unbranded instead of throwing.

## Context / why
D16 (dead scaffold removed — zero non-test callers; `DEFAULT_BRAND` points at non-existent assets), D24 (never crash on a cosmetic misconfig), D30 (no dead public API on npm).

## Scope references
- `swe/grills/ui-library.md` D16, D24; AC6
- `packages/ui-library/src/brand/config.ts`, `theme-injection.ts`, their tests; `theme/appearance-store.ts`

## What to build
- Delete `getActiveBrand`, `_setActiveBrand`, `_resetActiveBrand`, `resolveBrandConfig`, `BrandResolution`, `buildBrandedThemes`, `DEFAULT_BRAND` and their tests.
- Schema: `productName`, `assets` become optional (or removed — keep optional to tolerate existing config objects); `colors.accent` remains required.
- Appearance controller: `BrandConfigSchema.safeParse(brandConfig)`; on failure `console.warn` **once per controller** with the Zod error paths and ignore the brand.

## Out of scope
- Dev-only warnings for CSS/second boundary (t004).

## Acceptance criteria
- [x] AC6 (brand part): invalid `accent` → exactly one `console.warn`, resolved theme equals the unbranded theme (unit test with a spied `console.warn`).
- [x] Valid `{ colors: { accent } }` without `productName`/`assets` brands the theme.
- [x] `rg 'DEFAULT_BRAND|getActiveBrand|buildBrandedThemes' packages` empty.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
