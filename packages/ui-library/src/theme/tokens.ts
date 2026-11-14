// Theme scale tokens (theme-invariant unless patched by Appearance settings).
// Exact values per design-system.md § Scales.

// spacing: key = literal px value (dot-free by construction — a CSS custom-property name
// cannot contain a literal `.`; an earlier "key = px / 4" scheme used fractional keys like
// "1.5"/"7.5", which silently emitted INVALID custom properties `--pi-spacing-1.5` that no
// browser ever resolves, so every padding/margin/gap using one collapsed to nothing app-wide.
// Covers every value actually in use across the app — analogous to fontSize's "dense ladder
// covering the rungs the UI actually uses" rather than forcing existing, deliberately-tuned
// spacing onto a sparser grid and visibly nudging it.
export const spacing = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "10": 10,
  "11": 11,
  "12": 12,
  "14": 14,
  "16": 16,
  "20": 20,
  "24": 24,
  "26": 26,
  "30": 30,
  "32": 32,
  "48": 48,
  "64": 64,
  "80": 80,
  "96": 96,
  "128": 128,
} as const;
export type Spacing = typeof spacing;
export type SpacingKey = keyof Spacing;

// fontSize — a dense, mostly 1px-step ladder covering the rungs the UI actually uses, plus the
// document base and the display sizes above it. Every `font-size` in the app resolves to one of
// these rungs through `var(--pi-font-size-*)`; CSS modules never hardcode a literal, so this
// table is the ONE lever for the app's text size (packages/web-client/AGENTS.md § Invariants).
// Values are px and are typed as `number` (not literals) so `applyAppearance` can patch them at
// runtime; `theme/css-bridge.ts` emits them as rem against the untouched 16px root.
export type FontSizeKey =
  | "4xs"
  | "3xs"
  | "2xs"
  | "xs"
  | "code"
  | "sm"
  | "md"
  | "base"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl";

// Tuning history, so nobody re-walks it: the original ladder (9/10/11/12/13/14/16) read too small,
// a ~1.25x pass overshot, ~1.125x still ran slightly large. This is ~1.06x — the micro rungs stay
// where 1.125x put them (below `4xs`=10 the badges stop being legible at all), and everything from
// `xs` up steps back down by 1px. Retuning the app's text size means editing THIS TABLE ONLY.
export const baseFontSize: Readonly<Record<FontSizeKey, number>> = {
  "4xs": 10, // micro badges (queued, command-kind)
  "3xs": 11, // micro meta (author label, git status badge)
  "2xs": 12, // secondary meta (versions, counts, line numbers, hunk headers)
  xs: 13, // dense UI text — the most common rung
  code: 13, // code/diff surfaces; tracks its own base, not the prose one
  sm: 14, // primary UI text, row titles, tab labels
  md: 15, // prose and form controls
  base: 17, // document base — inputs, screen titles, composer (FONT_SIZE_BASE anchor)
  lg: 19,
  xl: 21,
  "2xl": 23,
  "3xl": 28,
  "4xl": 36,
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

/**
 * Terminal-only font stack (`features/terminal/TerminalPanel.tsx`).
 *
 * Separate from `DEFAULT_MONO_FONT` on purpose: the app's mono surfaces render *our* text, where a
 * platform font is the right default, while the terminal renders a real shell whose prompt may
 * paint Nerd Font glyphs (powerlevel10k's own docs recommend MesloLGS NF). Those glyphs live in
 * the private-use planes and simply do not exist in `ui-monospace`.
 *
 * Order is the whole design:
 *   1-2. A locally installed MesloLGS NF — a user who followed the p10k font instructions gets
 *        exactly what their desktop terminal shows, and downloads nothing.
 *   3.   "Cascadia Mono NF", the bundled webfont (`theme/fonts.css`) — the guaranteed floor, so
 *        icons render on a machine that has no Nerd Font installed at all.
 *   4+.  Platform monospace, for the case where even the bundled face fails to load.
 * Fallback is resolved by the browser per character, which is what makes 1-3 compose: MesloLGS NF
 * has no braille glyphs, so a spinner falls through to the bundled face while the rest of the line
 * stays Meslo.
 */
export const TERMINAL_FONT_STACK =
  '"MesloLGS NF", "MesloLGS Nerd Font Mono", "Cascadia Mono NF", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

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
