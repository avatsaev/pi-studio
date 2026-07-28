/**
 * Pure reload-gating decision for the molecule viewer's live reload (task-006/007). Kept in its
 * own module — like `molecule-source.ts` — so it is unit-testable without importing
 * `@molviewer/core` (which touches `document` at module scope).
 *
 * The gate is intentionally just "are there unsaved in-viewer edits right now" — no timestamp or
 * echo-suppression window. A future in-viewer "Save" cannot self-trigger a clobber: a save can
 * only happen while `modified` is `true`, and the earliest it flips back to `false` is after the
 * write completes — at which point a reload triggered by that same write is a content no-op.
 */
export interface ShouldApplyRefreshArgs {
  /** Timestamp of the last `file_changed` push for this path, or `null` if none yet. */
  changedAt: number | null;
  /** Timestamp of the last push this component actually reloaded for, or `null`. */
  lastAppliedAt: number | null;
  /** Whether the viewer currently has unsaved in-viewer edits. */
  modified: boolean;
}

export function shouldApplyRefresh({
  changedAt,
  lastAppliedAt,
  modified,
}: ShouldApplyRefreshArgs): boolean {
  if (changedAt === null) return false; // No change pushed yet.
  if (modified) return false; // Unsaved edits — leave the user's work alone.
  if (changedAt === lastAppliedAt) return false; // Already applied this push — no reload loop.
  return true;
}
