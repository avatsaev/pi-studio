# Task 001 — Theme system: tokens, variants, appearance application — Summary

- **Sprint:** sprint-012-ui-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Full design-system token layer and six theme variants, plus runtime appearance application (theme
switch, custom UI/mono fonts, font-size scaling).

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/theme/palette.ts` | created — raw Tailwind-style color scales (zinc/gray/slate/blue/green/red/teal/amber/yellow/purple/orange + white/black) |
| `packages/app/src/theme/color-utils.ts` | created — `hexToRgb`, `rgbToHex`, `relativeLuminance`, `contrastForeground`, `lighten`, `darken`, `isHexColor` |
| `packages/app/src/theme/tokens.ts` | created — `spacing`, `baseFontSize`, `baseLineHeight`, `fontWeight`, `borderRadius`, `borderWidth`, `opacity`, `iconSize`, `buildShadows`, default font stacks |
| `packages/app/src/theme/colors.ts` | created — `ThemeColors` type, `SyntaxColors`, `TerminalTheme`, `DarkTintConfig`, `buildDarkColors`, `buildLightColors` |
| `packages/app/src/theme/variants.ts` | created — six `ThemeVariant` records built from the builders; `THEME_NAMES`, `THEME_VARIANTS`, `THEME_SWATCHES` |
| `packages/app/src/theme/theme.ts` | created — `Theme` type, `getTheme`, `applyAppearance`, `AppearanceSettings`, `DEFAULT_THEME_NAME` |
| `packages/app/src/theme/index.ts` | created — barrel re-export |
| `packages/app/src/theme/theme.test.ts` | created — 52 tests |
| `packages/app/src/index.ts` | modified — re-exports theme index |
| `packages/app/tsconfig.json` | modified — include `*.test.ts` |

## How it satisfies the scope

- **Token tables** (`spacing`, `baseFontSize`, `fontWeight`, `borderRadius`, `borderWidth`, `opacity`,
  `iconSize`, `lineHeight`) match the exact values in design-system.md § Scales.
- **Layer-based semantic color system** (`surface0`–`surface4`, special surfaces, text, brand, semantic,
  borders, status, diff, scrollbar, legacy aliases) plus nested `palette`/`syntax`/`terminal`.
- **Six variants** — `light` (direct builder), `dark/zinc/midnight/claude/ghostty` (dark-tint builder
  with per-variant tint config matching the doc table accents and swatches).
- **`fontSize`/`fontFamily`/`lineHeight` widened** to plain `number`/`string` so `applyAppearance` can
  patch them; all other tokens retain literal types.
- **`applyAppearance`** — theme switch, custom UI/mono fonts, font-size scaling (base-relative, clamped
  10–24 px), code surfaces keep mono font since `fontFamily.mono` is patched independently.
- `contrastForeground` auto-derives `accentForeground` for all dark variants; light/dark brand green
  share `#20744A` per the spec table.

## Build & test results

```
$ npx vitest run packages/app/src/theme/theme.test.ts
 ✓ packages/app/src/theme/theme.test.ts (52 tests) 9ms
 Test Files  1 passed (1)
      Tests  52 passed (52)
```

## Acceptance criteria

- [x] Switching among the six variants produces distinct `colorScheme`/`colors`/`swatch` — verified
      by the "color completeness" suite across all six variants.
- [x] Applying a custom UI/mono font + font size patches the live theme; code surfaces keep the mono
      font — verified by `applyAppearance` suite (7 cases).
- [x] All token tables from the doc are present with the documented values — verified by dedicated
      spacing/fontSize/iconSize/font-stack tests.

## Follow-ups / TODO(verify)

- Appearance-settings storage key (AsyncStorage) — deferred to persistence sprint.
- The "without re-rendering styled subtrees" guarantee is an engine-level property of
  `react-native-unistyles` v3 and will be exercised when the styling engine is wired in task-002.
