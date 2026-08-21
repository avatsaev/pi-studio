// Public surface of the theme system.
export { palette, type Palette, type PaletteScale, type PaletteShade } from "./palette.js";
export {
  hexToRgb,
  rgbToHex,
  relativeLuminance,
  contrastForeground,
  lighten,
  darken,
  isHexColor,
  type Rgb,
} from "./color-utils.js";
export {
  spacing,
  baseFontSize,
  baseLineHeight,
  fontWeight,
  borderRadius,
  borderWidth,
  opacity,
  iconSize,
  buildShadows,
  DEFAULT_UI_FONT,
  DEFAULT_MONO_FONT,
  type SpacingKey,
  type FontSizeKey,
  type Shadow,
  type ShadowSet,
} from "./tokens.js";
export {
  buildDarkColors,
  buildLightColors,
  type ThemeColors,
  type DarkTintConfig,
  type SyntaxColors,
  type TerminalTheme,
} from "./colors.js";
export {
  THEME_NAMES,
  THEME_VARIANTS,
  THEME_SWATCHES,
  type ThemeName,
  type ThemeVariant,
} from "./variants.js";
export {
  getTheme,
  applyAppearance,
  DEFAULT_THEME_NAME,
  type Theme,
  type AppearanceSettings,
} from "./theme.js";
export { flattenThemeToVars, applyVarsToRoot, applyThemeToDOM } from "./css-bridge.js";
export {
  createAppearanceController,
  type AppearanceController,
  type AppearanceState,
  type AppearanceMode,
  type KeyValueStore,
} from "./appearance-store.js";
export {
  ThemeBoundary,
  useAppearance,
  useResolvedTheme,
  type ThemeBoundaryProps,
} from "./ThemeBoundary.js";
