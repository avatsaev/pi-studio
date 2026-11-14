/**
 * Fork picker keyboard navigation — pure index arithmetic for `ForkDialog.tsx`'s picker step
 * (sprint-072/task-005, visual spec § 11). Split out so the clamping rule is testable without
 * mounting the dialog or depending on `document.activeElement`, the same rationale `fork-result.ts`
 * documents for its own stores-only split.
 */

/**
 * Computes the row index ↑/↓ should move focus to. Plain focusable `<button>`s, not a
 * roving-tabindex widget — the caller still calls `.focus()` on the returned index; Enter/Space
 * already activate the focused button natively. Clamps rather than wraps at either end (no cyclic
 * wraparound) and is a no-op when there is nothing to move between.
 */
export function nextPickerFocusIndex(
  currentIndex: number,
  key: "ArrowDown" | "ArrowUp",
  rowCount: number,
): number {
  if (rowCount === 0) return -1;
  const delta = key === "ArrowDown" ? 1 : -1;
  return Math.min(Math.max(currentIndex + delta, 0), rowCount - 1);
}
