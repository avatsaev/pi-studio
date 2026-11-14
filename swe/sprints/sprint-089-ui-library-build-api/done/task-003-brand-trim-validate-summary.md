# Summary — sprint-089 task-003 brand-trim-validate

## What was built
Deleted `DEFAULT_BRAND`, `resolveBrandConfig`, `BrandResolution`, `getActiveBrand`/`_setActiveBrand`/`_resetActiveBrand` and `buildBrandedThemes`. `BrandConfigSchema` now requires only `colors.accent` (`productName`, `assets` optional). The appearance controller validates `brandConfig` once at creation (`safeParse`); on failure it `console.warn`s once with the Zod issue paths and renders the unbranded theme. No brand tests existed to delete. Updated the stale comment in web-client `brand/build-brand.ts`.

## Acceptance criteria
- [x] Invalid `accent: "blue"` → exactly one warn (mentions `colors.accent`) across `setMode`/`updateSettings`, theme unbranded. [x] `{ colors: { accent } }` alone brands the accent and leaves surfaces unchanged. [x] `rg 'DEFAULT_BRAND|getActiveBrand|buildBrandedThemes' packages` → no source hits.

## Follow-ups
- Brand docs (`swe` specs aside) are covered by s090/task-005.
