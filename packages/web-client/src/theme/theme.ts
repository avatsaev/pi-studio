// Full Theme type + runtime appearance application.
// design-system.md § Theme token shape, § Behavior (appearance application)

import {
  baseFontSize,
  baseLineHeight,
  borderRadius,
  borderWidth,
  buildShadows,
  DEFAULT_MONO_FONT,
  DEFAULT_UI_FONT,
  fontWeight,
  iconSize,
  opacity,
  spacing,
  type FontSizeKey,
  type ShadowSet,
} from "./tokens.js";
import { type ThemeColors } from "./colors.js";
import { type ThemeName, THEME_VARIANTS } from "./variants.js";

export type Theme = {
  name: ThemeName;
  colorScheme: "light" | "dark";
  colors: ThemeColors;
  spacing: typeof spacing;
  // fontSize is Record<FontSizeKey, number> (not readonly narrowed literals) so appearance
  // patch can replace values without a type error.
  fontSize: Record<FontSizeKey, number>;
  fontFamily: {
    // Both are plain strings so custom fonts can be spliced in at runtime.
    ui: string;
    mono: string;
  };
  lineHeight: Record<"diff", number>;
  iconSize: typeof iconSize;
  fontWeight: typeof fontWeight;
  borderRadius: typeof borderRadius;
  borderWidth: typeof borderWidth;
  opacity: typeof opacity;
  shadow: ShadowSet;
  swatch: string;
};

function buildTheme(name: ThemeName): Theme {
  const variant = THEME_VARIANTS[name];
  return {
    name,
    colorScheme: variant.colorScheme,
    colors: variant.colors,
    spacing,
    fontSize: { ...baseFontSize },
    fontFamily: {
      ui: DEFAULT_UI_FONT,
      mono: DEFAULT_MONO_FONT,
    },
    lineHeight: { ...baseLineHeight },
    iconSize,
    fontWeight,
    borderRadius,
    borderWidth,
    opacity,
    shadow: buildShadows(variant.colorScheme),
    swatch: variant.swatch,
  };
}

// ---------------------------------------------------------------------------
// Appearance settings + runtime patch
// ---------------------------------------------------------------------------

export type AppearanceSettings = {
  /** One of the six named theme variants. */
  themeName?: ThemeName;
  /** Custom UI font family string; empty/undefined → platform default. */
  uiFont?: string;
  /** Custom mono font family string; empty/undefined → platform default. */
  monoFont?: string;
  /**
   * Desired base font size (px). All fontSize tokens are scaled relative to the
   * documented base of 16px. Clamped 10–24.
   */
  fontSize?: number;
};

const FONT_SIZE_BASE = 16;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;

/**
 * Apply appearance settings to a base theme and return a new patched theme.
 * The base theme object is never mutated.
 * Code/mono surfaces keep the mono font because they reference `fontFamily.mono`
 * independently — a custom `uiFont` only patches `fontFamily.ui`.
 */
export function applyAppearance(base: Theme, settings: AppearanceSettings): Theme {
  const themeName: ThemeName = settings.themeName ?? base.name;
  const baseTheme = buildTheme(themeName);

  const uiFont =
    settings.uiFont && settings.uiFont.trim() !== "" ? settings.uiFont : DEFAULT_UI_FONT;
  const monoFont =
    settings.monoFont && settings.monoFont.trim() !== "" ? settings.monoFont : DEFAULT_MONO_FONT;

  let fontSize = { ...baseTheme.fontSize };
  if (settings.fontSize != null) {
    const clamped = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, settings.fontSize));
    const scale = clamped / FONT_SIZE_BASE;
    const key: FontSizeKey[] = ["xs", "code", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
    for (const k of key) {
      const base = baseFontSize[k];
      // `code` always tracks the xs/code document base, not the prose base, to avoid
      // code surfaces growing disproportionately.
      fontSize[k] = Math.round(base * scale);
    }
  }

  return {
    ...baseTheme,
    fontSize,
    fontFamily: { ui: uiFont, mono: monoFont },
  };
}

// ---------------------------------------------------------------------------
// Theme registry / accessor
// ---------------------------------------------------------------------------

/** Build a fresh Theme for the given name with default appearance settings. */
export function getTheme(name: ThemeName): Theme {
  return buildTheme(name);
}

export const DEFAULT_THEME_NAME: ThemeName = "dark";
export { type ThemeName };
