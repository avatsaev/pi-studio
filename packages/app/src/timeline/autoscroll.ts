// Bottom-anchoring autoscroll state machine.
// clean-room-scope/features/timeline-rendering.md § Autoscroll / bottom anchoring

export type AutoscrollMode = "sticky-bottom" | "detached";

export type AutoscrollState = {
  mode: AutoscrollMode;
  /** Stable row id that the anchor is locked on (for prepend stability). */
  anchorRowId: string | undefined;
  /** Whether the scroll-to-bottom button should be visible. */
  showJumpButton: boolean;
  /** Whether a scroll-to-bottom attempt is pending/in-flight. */
  pending: boolean;
};

export const INITIAL_AUTOSCROLL_STATE: AutoscrollState = {
  mode: "sticky-bottom",
  anchorRowId: undefined,
  showJumpButton: false,
  pending: false,
};

export const NEAR_BOTTOM_THRESHOLD_PX = 80;

// Called when new rows arrive — scroll only if sticky.
export function onRowsAdded(state: AutoscrollState): AutoscrollState & { shouldScroll: boolean } {
  return { ...state, shouldScroll: state.mode === "sticky-bottom" };
}

// Called when the user scrolls. distanceFromBottom is in pixels.
export function onScroll(state: AutoscrollState, distanceFromBottom: number): AutoscrollState {
  const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  if (nearBottom && state.mode === "detached") {
    return { ...state, mode: "sticky-bottom", showJumpButton: false };
  }
  if (!nearBottom && state.mode === "sticky-bottom") {
    return { ...state, mode: "detached", showJumpButton: true };
  }
  return { ...state, showJumpButton: !nearBottom };
}

// Called on initial entry or "resume" route intent — trigger a scroll-to-bottom attempt.
export function onEntry(state: AutoscrollState): AutoscrollState & { shouldScroll: boolean } {
  return { ...state, mode: "sticky-bottom", showJumpButton: false, pending: true, shouldScroll: true };
}

// User pressed "jump to latest".
export function onJumpToBottom(state: AutoscrollState): AutoscrollState & { shouldScroll: boolean } {
  return { ...state, mode: "sticky-bottom", showJumpButton: false, pending: true, shouldScroll: true };
}

// User sent a message — force scroll to bottom.
export function onMessageSent(state: AutoscrollState): AutoscrollState & { shouldScroll: boolean } {
  return { ...state, mode: "sticky-bottom", showJumpButton: false, pending: false, shouldScroll: true };
}

// Scroll completion — clear pending.
export function onScrollComplete(state: AutoscrollState): AutoscrollState {
  return { ...state, pending: false };
}

// Record an anchor row for prepend stability (set before inserting older catch-up pages).
export function setAnchorRow(state: AutoscrollState, rowId: string): AutoscrollState {
  return { ...state, anchorRowId: rowId };
}

// Clear anchor after the viewport has been restored.
export function clearAnchorRow(state: AutoscrollState): AutoscrollState {
  return { ...state, anchorRowId: undefined };
}
