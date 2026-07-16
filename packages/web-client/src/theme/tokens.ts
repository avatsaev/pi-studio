// Theme scale tokens (theme-invariant unless patched by Appearance settings).
// Exact values per design-system.md § Scales.

// spacing: 4px base grid.
export const spacing = {
  "0": 0,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "3": 12,
  "4": 16,
  "6": 24,
  "8": 32,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96,
  "32": 128,
} as const;
export type Spacing = typeof spacing;
export type SpacingKey = keyof Spacing;

// fontSize keys — values deliberately typed as `number` (not literals) so the appearance
// updater can patch them at runtime. `baseFontSize` holds the documented defaults.
export type FontSizeKey =
  | "xs"
  | "code"
  | "sm"
  | "base"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl";

export const baseFontSize: Readonly<Record<FontSizeKey, number>> = {
  xs: 12,
  code: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 22,
  "3xl": 26,
  "4xl": 34,
};

// fontWeight — RN-style string weights.
export const fontWeight = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;
export type FontWeight = typeof fontWeight;

export const borderRadius = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;
export type BorderRadius = typeof borderRadius;

export const borderWidth = {
  "0": 0,
  "1": 1,
  "2": 2,
} as const;
export type BorderWidth = typeof borderWidth;

export const opacity = {
  "0": 0,
  "50": 0.5,
  "100": 1,
} as const;
export type Opacity = typeof opacity;

export const iconSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
} as const;
export type IconSize = typeof iconSize;

// lineHeight.diff is reserved for code/diff; prose uses fontSize.base * ~1.4 at render time.
export const baseLineHeight = { diff: 22 } as const;

// Default platform font stacks (seeds; appearance can override the `ui` stack).
export const DEFAULT_UI_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const DEFAULT_MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export type Shadow = {
  color: string;
  offsetX: number;
  offsetY: number;
  radius: number;
  elevation: number;
};

export type ShadowSet = { sm: Shadow; md: Shadow; lg: Shadow };

// Shadow builder — dark themes use a stronger alpha-tinted color.
export function buildShadows(colorScheme: "light" | "dark"): ShadowSet {
  const color = colorScheme === "dark" ? "rgba(0,0,0,0.55)" : "rgba(24,24,27,0.12)";
  return {
    sm: { color, offsetX: 0, offsetY: 1, radius: 2, elevation: 1 },
    md: { color, offsetX: 0, offsetY: 3, radius: 8, elevation: 4 },
    lg: { color, offsetX: 0, offsetY: 10, radius: 24, elevation: 12 },
  };
}
