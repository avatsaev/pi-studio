// Brand accent injection into theme variants.
// design-system.md § Theme variants (Brand injection)
// features/white-label-branding.md § Behavior & Algorithms

import { type ResolvedBrandColors, resolveAccentColors, type BrandConfig } from "./config.js";
import { type Theme } from "@pi-studio-ui/theme/theme.js";
import { type ThemeName, THEME_NAMES } from "@pi-studio-ui/theme/variants.js";
import { getTheme } from "@pi-studio-ui/theme/theme.js";

/**
 * Build a branded copy of a theme by replacing only the accent family tokens
 * and swatch. All other tokens (surfaces, semantic status, syntax, terminal)
 * remain unchanged — only the accent family is brand-overridable in this version.
 */
export function injectBrandAccent(theme: Theme, resolved: ResolvedBrandColors): Theme {
  return {
    ...theme,
    colors: {
      ...theme.colors,
      accent: resolved.accent,
      accentBright: resolved.accentBright,
      accentForeground: resolved.accentForeground,
      // Legacy aliases that mirror accent.
      primary: resolved.accent,
      ring: resolved.accent,
    },
    swatch: resolved.swatch,
  };
}

/**
 * Build all six branded themes from a brand config.
 * Returns a map from theme name → patched Theme.
 */
export function buildBrandedThemes(brand: BrandConfig): Readonly<Record<ThemeName, Theme>> {
  const resolved = resolveAccentColors(brand.colors);
  const result = {} as Record<ThemeName, Theme>;
  for (const name of THEME_NAMES) {
    result[name] = injectBrandAccent(getTheme(name), resolved);
  }
  return result;
}
