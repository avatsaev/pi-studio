// Overlay / portal positioning engine.
// design-system.md § Overlay & portal infrastructure, § Positioning engine

export type Rect = { x: number; y: number; width: number; height: number };

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export type PositionInput = {
  trigger: Rect;
  content: { width: number; height: number };
  window: { width: number; height: number };
  /**
   * Preferred side. The engine will auto-flip to the opposite side when there
   * is insufficient space on the preferred side.
   */
  preferredSide: Side;
  /**
   * Alignment along the cross-axis.
   */
  align: Align;
  /**
   * Edge padding (px) used when clamping the resolved position to the screen.
   * Defaults to 8.
   */
  edgePadding?: number;
  /**
   * Android translucent-status-bar offset to add to the trigger's y coordinate
   * before computing position. Default 0.
   */
  androidStatusBarOffset?: number;
};

export type ResolvedPosition = {
  top: number;
  left: number;
  /** The side the overlay ended up on (after auto-flip). */
  side: Side;
};

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Core positioning routine shared by dropdowns, context menus, and tooltips.
 *
 * Algorithm (design-system.md § Positioning engine):
 * 1. Measure trigger in window coordinates (+ Android status-bar offset).
 * 2. Choose a side: use `preferredSide` if there is enough room, otherwise
 *    flip to the opposite side.
 * 3. Align start/center/end along the cross-axis.
 * 4. Clamp to screen with `edgePadding` (default 8px).
 */
export function resolvePosition(input: PositionInput): ResolvedPosition {
  const {
    trigger,
    content,
    window: win,
    preferredSide,
    align,
    edgePadding = 8,
    androidStatusBarOffset = 0,
  } = input;

  const tx = trigger.x;
  const ty = trigger.y + androidStatusBarOffset;
  const tw = trigger.width;
  const th = trigger.height;
  const cw = content.width;
  const ch = content.height;

  // Step 1 & 2: choose side with auto-flip.
  let side: Side = preferredSide;

  if (side === "bottom") {
    const spaceBelow = win.height - (ty + th);
    if (spaceBelow < ch && ty > ch) side = "top";
  } else if (side === "top") {
    const spaceAbove = ty;
    if (spaceAbove < ch && win.height - (ty + th) > ch) side = "bottom";
  } else if (side === "right") {
    const spaceRight = win.width - (tx + tw);
    if (spaceRight < cw && tx > cw) side = "left";
  } else {
    // left
    const spaceLeft = tx;
    if (spaceLeft < cw && win.width - (tx + tw) > cw) side = "right";
  }

  // Step 3: initial top/left from chosen side.
  let top: number;
  let left: number;

  if (side === "bottom") {
    top = ty + th;
    left = alignCross(tx, tw, cw, align);
  } else if (side === "top") {
    top = ty - ch;
    left = alignCross(tx, tw, cw, align);
  } else if (side === "right") {
    top = alignCross(ty, th, ch, align);
    left = tx + tw;
  } else {
    // left
    top = alignCross(ty, th, ch, align);
    left = tx - cw;
  }

  // Step 4: clamp to screen with edge padding.
  top = clamp(top, edgePadding, win.height - ch - edgePadding);
  left = clamp(left, edgePadding, win.width - cw - edgePadding);

  return { top, left, side };
}

function alignCross(anchorStart: number, anchorSize: number, contentSize: number, align: Align): number {
  switch (align) {
    case "start":
      return anchorStart;
    case "end":
      return anchorStart + anchorSize - contentSize;
    case "center":
      return anchorStart + anchorSize / 2 - contentSize / 2;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Compact reroute helper
// design-system.md: on compact form factor, anchored overlays render as
// bottom sheets instead of anchored popovers.
// ---------------------------------------------------------------------------

export type OverlayMode = "anchored" | "bottom-sheet";

/**
 * Returns the appropriate overlay rendering mode for the current form factor.
 * - compact → bottom-sheet
 * - non-compact → anchored popover
 */
export function resolveOverlayMode(isCompact: boolean): OverlayMode {
  return isCompact ? "bottom-sheet" : "anchored";
}

// ---------------------------------------------------------------------------
// Z-order constants (web overlay root stacking).
// ---------------------------------------------------------------------------
export const Z_ORDER = {
  modal: 100,
  toast: 200,
} as const;
