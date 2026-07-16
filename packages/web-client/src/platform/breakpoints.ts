// Breakpoints, layout constants, and form-factor utilities.
// design-system.md § Breakpoints & layout constants

// ---------------------------------------------------------------------------
// Breakpoints (min-width px)
// ---------------------------------------------------------------------------
export const breakpoints = {
  xs: 0,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
} as const;
export type Breakpoint = keyof typeof breakpoints;

/** Returns the active breakpoint name for a given container/window width. */
export function getBreakpoint(width: number): Breakpoint {
  if (width >= breakpoints.xl) return "xl";
  if (width >= breakpoints.lg) return "lg";
  if (width >= breakpoints.md) return "md";
  if (width >= breakpoints.sm) return "sm";
  return "xs";
}

/**
 * Compact form factor = xs or sm (phone-class layout).
 * This is the single source of truth for "phone-class layout" —
 * never use Platform.OS as a layout proxy.
 */
export function isCompactFormFactor(width: number): boolean {
  const bp = getBreakpoint(width);
  return bp === "xs" || bp === "sm";
}

// ---------------------------------------------------------------------------
// Fixed layout constants (design-system.md § Breakpoints & layout constants)
// ---------------------------------------------------------------------------
export const HEADER_INNER_HEIGHT = 48; // desktop
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const HEADER_TOP_PADDING_MOBILE = 8;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36; // tab strip / panel toolbars
export const FOOTER_HEIGHT = 75;
export const MAX_CONTENT_WIDTH = 820; // chat / stream / input centered column
export const COMPACT_FORM_FACTOR_WIDTH = 500; // per-container composer compaction threshold

// Desktop window chrome reserves (used by ScreenHeader to avoid overlapping controls).
export const WINDOW_CHROME = {
  macOS: { width: 78, height: 45 }, // traffic-light reserve
  windowsLinux: { width: 140, height: 48 },
} as const;
