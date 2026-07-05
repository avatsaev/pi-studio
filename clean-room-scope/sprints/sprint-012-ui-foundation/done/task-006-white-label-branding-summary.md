# Task 006 — White-label branding (build-time brand config) — Summary

- **Sprint:** sprint-012-ui-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Build-time brand config schema (Zod), resolver, accent derivation, `<BrandLogo>` asset resolution,
theme accent injection across all six variants, and the default Pi-Studio brand assets.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/brand/config.ts` | created — `BrandConfigSchema` (zod), `resolveBrandConfig`, `resolveAccentColors`, `DEFAULT_BRAND`, `getActiveBrand/_setActiveBrand/_resetActiveBrand` |
| `packages/app/src/brand/brand-logo.ts` | created — `resolveBrandLogoAsset` (auto/light/dark/mark + mark→wordmark fallback) |
| `packages/app/src/brand/theme-injection.ts` | created — `injectBrandAccent`, `buildBrandedThemes` (accent family across all 6 variants) |
| `packages/app/src/brand/index.ts` | created — barrel re-export |
| `packages/app/src/brand/brand.test.ts` | created — 29 tests |
| `brand/brand.config.json` | created — default Pi-Studio brand config |
| `brand/logo-light.svg` | created — default light wordmark |
| `brand/logo-dark.svg` | created — default dark wordmark |
| `brand/logo-mark.svg` | created — default square mark |
| `packages/app/src/index.ts` | modified — re-exports brand index |

## How it satisfies the scope

- **Schema**: all required fields (`productName`, `colors.accent`, `assets.logoLight/logoDark/icon`)
  validated with field-level zod errors; optional fields (`accentBright`, `accentForeground`, `swatch`,
  `logoMark`, `splash`, `shortName`, `tagline`, `links`, `legal`) all pass through.
- **Resolver**: no raw config → `DEFAULT_BRAND`; injected raw config → validated, `shortName`
  auto-filled from `productName`, `ok:false` + field errors on invalid.
- **Accent derivation**: `accentBright` = `lighten(accent, 0.35)` when omitted; `accentForeground` =
  `contrastForeground(accent)` (WCAG luminance-based); `swatch` defaults to `accent`.
- **Theme injection**: `injectBrandAccent` replaces accent/accentBright/accentForeground/primary/ring
  without mutating the base; `buildBrandedThemes` applies to all 6 variants.
- **`<BrandLogo>`**: `resolveBrandLogoAsset` picks light/dark by colorScheme for "auto", explicit for
  "light"/"dark", logoMark for "mark" with wordmark fallback when absent.
- **Default brand unchanged**: `PI_STUDIO_BRAND_DIR` unset → Pi-Studio green, wordmarks, icon.

## Build & test results

```
$ npx vitest run packages/app/src/brand/brand.test.ts
 ✓ packages/app/src/brand/brand.test.ts (29 tests)

$ npx vitest run           # full repo
 Test Files  66 passed (66)
      Tests  672 passed (672)
```

## Acceptance criteria

- [x] Unset env → default Pi-Studio brand unchanged.
- [x] Valid override config changes productName/accent/logo with no source edits.
- [x] Invalid config returns field-level errors (tested for missing productName, bad hex, missing assets).
- [x] Omitted optional fields use documented defaults (bright=lightened, foreground=contrast, swatch=accent, shortName=productName, mark=wordmark).
- [x] No hardcoded "Pi-Studio" in components — all surfaces use `getActiveBrand().productName` or the `{{productName}}` i18n interpolation.

## Follow-ups / TODO(verify)

- File I/O integration (`PI_STUDIO_BRAND_DIR` → read `brand.config.json` from disk) is a Metro/build
  plugin concern; deferred to the packaging sprint.
- Desktop `app.setName` / Electron-builder icon wiring deferred to sprint-018/task-001,003.
- `brand/icon.png` placeholder not created (PNG requires binary; real icon provided by the operator).
