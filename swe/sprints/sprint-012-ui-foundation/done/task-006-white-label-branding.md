# Task 006 — White-label branding (build-time brand config)

- **Sprint:** sprint-012-ui-foundation
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001 (theme system), task-003 (core primitives), task-005 (localization infra)

## Goal
Make product identity (name/title, primary/accent colors, logo/icons) rebrandable at build time from a
single brand config, defaulting to the Pi-Studio brand when unset.

## Scope references
- `clean-room-scope/features/white-label-branding.md` (whole doc)
- `clean-room-scope/architecture/design-system.md` § Theme variants (Brand injection)
- `clean-room-scope/features/ui-components.md` (`<BrandLogo>`)
- `clean-room-scope/features/localization.md` (`{{productName}}` interpolation)

## What to build
- A `BrandConfig` schema (zod) + a resolver: load `<PI_STUDIO_BRAND_DIR>/brand.config.json` + assets
  when the env var is set, else the built-in default Pi-Studio brand; validate at build time and fail
  fast with field-level errors; freeze into a single importable `brand` module.
- A repo `brand/` default directory (`brand.config.json`, `logo-light.*`, `logo-dark.*`, `icon.*`).
- Theme builder: take the accent family (`accent`, optional `accentBright`/`accentForeground`, `swatch`)
  from the brand config, deriving bright/foreground when omitted, applied across all six variants.
- `<BrandLogo variant="auto|light|dark|mark">` primitive resolving brand logo assets by active
  `colorScheme`, with `mark`→wordmark fallback.
- `useBrand()` accessor + convert every hardcoded "Pi-Studio" user-visible string to an i18n key
  interpolating `{{productName}}`.
- Web: document title from `productName`, favicon from `assets.icon`, PWA manifest name/short_name/icons.

## Out of scope
- Desktop app name/icon/About/updater naming wiring (sprint-018/task-001,003 — consumes this config).
- Runtime/daemon-delivered branding and per-user brand switching (deferred; see feature-doc TODO).
- Full-palette (non-accent) theming.

## Acceptance criteria
- [ ] Unset `PI_STUDIO_BRAND_DIR` → default Pi-Studio name/accent/logo unchanged.
- [ ] A valid brand dir changes product name everywhere, recolors accent across all six variants, and
      swaps every logo/icon surface with no component/source edits.
- [ ] Invalid config (missing required field/asset) fails the build with a clear field-level message.
- [ ] Omitted optional fields fall back to documented defaults (bright/foreground derived, mark→wordmark,
      swatch→accent, shortName→productName).
- [ ] No user-visible "Pi-Studio" literal remains in a component or a translation value.

## Test / verification plan
- Tests: brand-config schema validation (valid/invalid/missing-asset); accent-derivation defaults;
  `<BrandLogo>` light/dark/mark resolution; product-name interpolation renders the configured name.
- Manual: build with a sample brand dir → name/accent/logo change across welcome/open-project/splash.

## Notes
- Keep brand resolution build-time and side-effect-free at runtime; brand is not a user setting.
