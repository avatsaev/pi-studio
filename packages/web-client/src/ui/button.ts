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

// Font size per size, in rem (relative to the root font-size — see global.css) so button labels
// scale consistently with the rest of the app's text instead of staying pinned in absolute px.
export const BUTTON_FONT_SIZE: Record<ButtonSize, string> = {
  xs: "0.9375rem",
  sm: "1rem",
  md: "1.0625rem",
  lg: "1.1875rem",
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
