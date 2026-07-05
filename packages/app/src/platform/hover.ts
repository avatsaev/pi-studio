// Hover-to-show pattern helpers.
// design-system.md § Hover-to-show pattern

/**
 * Returns whether a hover-revealed control should be visible.
 *
 * Rule: `visible = isHovered || isNative || isCompact`
 *
 * - On touch/native: always visible (hover never fires).
 * - On compact form factor: always visible (no persistent hover state).
 * - On desktop web: only visible when hovered.
 *
 * @param isHovered  - True when the pointer is over the trigger (web only, via
 *                     pressable hover callbacks or onPointerEnter/Leave).
 * @param isNativeCtx - Pass `isNative` from platform/gating (or a test override).
 * @param isCompact  - Pass `useIsCompactFormFactor()` result (or a test override).
 */
export function hoverVisible(isHovered: boolean, isNativeCtx: boolean, isCompact: boolean): boolean {
  return isHovered || isNativeCtx || isCompact;
}

/**
 * Validates that pointer-enter/leave usage is web-gated.
 * Raw pointer events must never be registered on native (they don't fire and
 * would suppress touch). This helper is a guard for the pointer-event wiring.
 *
 * Throws in dev if called outside a web context.
 */
export function assertPointerEventsWebOnly(isWebCtx: boolean): void {
  if (!isWebCtx) {
    throw new Error(
      "onPointerEnter/Leave must only be registered inside isWeb-gated code. " +
        "Use pressable hover callbacks (which are cross-platform safe) instead.",
    );
  }
}
