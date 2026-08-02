// Button primitive — variant/size/state contracts.
// ui-components.md § Pressables

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

// Min-height per size (px) per ui-components.md: "min-heights from 28".
export const BUTTON_MIN_HEIGHT: Record<ButtonSize, number> = {
  xs: 28,
  sm: 32,
  md: 36,
  lg: 40,
};

// Icon size per button size (maps to iconSize token keys).
export const BUTTON_ICON_SIZE: Record<ButtonSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

// Horizontal padding per size.
export const BUTTON_PADDING_H: Record<ButtonSize, number> = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 16,
};

// Font size per size — CSS var references rather than literals, so buttons ride theme/tokens.ts's
// scale (and the Appearance font-size setting) with nothing to keep in sync here. `lg` maps to the
// document base; there is no 15px rung and nothing renders a `lg` button today.
export const BUTTON_FONT_SIZE: Record<ButtonSize, string> = {
  xs: "var(--pi-font-size-xs)",
  sm: "var(--pi-font-size-sm)",
  md: "var(--pi-font-size-md)",
  lg: "var(--pi-font-size-base)",
};

export type ButtonStateStyle = {
  opacity: number;
  /** Token key for background color. null = no bg (transparent). */
  bgToken: string | null;
};

/**
 * Resolve the opacity and background token for a button given its state.
 * - pressed → 0.85 opacity
 * - disabled or loading → 0.5 opacity
 * - ghost hover → special token swap (handled by caller reading `isGhostHover`)
 */
export function resolveButtonState(opts: {
  variant: ButtonVariant;
  pressed: boolean;
  disabled: boolean;
  loading: boolean;
}): { opacity: number; isGhostHover: false } {
  const { pressed, disabled, loading } = opts;
  if (disabled || loading) return { opacity: 0.5, isGhostHover: false };
  if (pressed) return { opacity: 0.85, isGhostHover: false };
  return { opacity: 1, isGhostHover: false };
}

/**
 * Returns the correct text/icon color token key for each variant.
 * This is what callers pass to the theme-prop binder for icon color.
 */
export function buttonIconColorToken(variant: ButtonVariant): string {
  switch (variant) {
    case "default":
      return "accentForeground";
    case "secondary":
      return "foreground";
    case "outline":
      return "accent";
    case "ghost":
      return "foregroundMuted"; // swaps to "foreground" on hover
    case "destructive":
      return "destructiveForeground";
  }
}

/** Returns "foreground" when ghost is hovered, else the default ghost color. */
export function ghostHoverIconToken(isHovered: boolean): string {
  return isHovered ? "foreground" : "foregroundMuted";
}
