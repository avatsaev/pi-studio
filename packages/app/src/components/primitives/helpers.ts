/**
 * Pure helper functions for the DOM primitive components.
 * Kept in a .ts file (no CSS imports) so they are testable in the node environment.
 * design-system.md § Hover-to-show, ui-components.md § Pressables
 */

import {
  type ButtonVariant,
  type ButtonSize,
  BUTTON_MIN_HEIGHT,
  BUTTON_PADDING_H,
  BUTTON_FONT_SIZE,
  BUTTON_ICON_SIZE,
  resolveButtonState,
  buttonIconColorToken,
  ghostHoverIconToken,
} from "../../ui/button.js";

// Re-export so tests only need one import.
export {
  BUTTON_MIN_HEIGHT,
  BUTTON_PADDING_H,
  BUTTON_FONT_SIZE,
  BUTTON_ICON_SIZE,
  resolveButtonState,
  buttonIconColorToken,
  ghostHoverIconToken,
  type ButtonVariant,
  type ButtonSize,
};

// ---------------------------------------------------------------------------
// Hover-to-show pattern
// design-system.md § Hover-to-show
// ---------------------------------------------------------------------------

/**
 * Returns true when a hover-revealed control should be visible.
 *   visible = isHovered || isNative || isCompact
 * On Pi-Studio (web-only), isNative is always false.
 */
export function hoverVisible(
  isHovered: boolean,
  isNative: boolean,
  isCompact: boolean,
): boolean {
  return isHovered || isNative || isCompact;
}

// ---------------------------------------------------------------------------
// Button ARIA / DOM attributes
// ---------------------------------------------------------------------------

export type ButtonAriaAttrs = {
  disabled: boolean;
  "aria-disabled": boolean | undefined;
  "aria-busy": boolean | undefined;
  tabIndex: number;
};

/**
 * Derive accessible DOM attributes for a button from its logical state.
 */
export function buttonAriaAttrs(opts: {
  disabled: boolean;
  loading: boolean;
}): ButtonAriaAttrs {
  const { disabled, loading } = opts;
  const isDisabled = disabled || loading;
  return {
    disabled: isDisabled,
    "aria-disabled": isDisabled || undefined,
    "aria-busy": loading || undefined,
    tabIndex: isDisabled ? -1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Button inline styles from token values (no CSS class needed)
// ---------------------------------------------------------------------------

export type ButtonInlineStyle = {
  minHeight: number;
  paddingLeft: number;
  paddingRight: number;
  fontSize: number;
  opacity: number;
};

export function buttonInlineStyle(opts: {
  size: ButtonSize;
  variant: ButtonVariant;
  pressed: boolean;
  disabled: boolean;
  loading: boolean;
}): ButtonInlineStyle {
  const { size, variant, pressed, disabled, loading } = opts;
  const { opacity } = resolveButtonState({ variant, pressed, disabled, loading });
  return {
    minHeight: BUTTON_MIN_HEIGHT[size],
    paddingLeft: BUTTON_PADDING_H[size],
    paddingRight: BUTTON_PADDING_H[size],
    fontSize: BUTTON_FONT_SIZE[size],
    opacity,
  };
}

// ---------------------------------------------------------------------------
// Icon size from button size
// ---------------------------------------------------------------------------

export function buttonIconPx(size: ButtonSize): number {
  return BUTTON_ICON_SIZE[size];
}

// ---------------------------------------------------------------------------
// Surface elevation → CSS variable name
// ---------------------------------------------------------------------------

export type SurfaceElevation = 0 | 1 | 2 | 3 | 4;

export function surfaceBgVar(elevation: SurfaceElevation): string {
  return `var(--pi-color-surface${elevation})`;
}

// ---------------------------------------------------------------------------
// StatusDot visibility
// ---------------------------------------------------------------------------

import { statusDotColor, type StatusDotInput } from "../../ui/status-dot.js";
export { statusDotColor, type StatusDotInput };

export function statusDotVisible(input: StatusDotInput): boolean {
  return statusDotColor(input) !== null;
}
