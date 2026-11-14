/**
 * Pure status-line formatter shared by drag-move and rename (`FileExplorer.tsx`'s `applyMove`) —
 * both report how many diff tabs a move/rename silently closed. Closing them is correct (a
 * per-path `git diff` on the new path returns empty right after a rename, so the daemon's
 * `--no-index` fallback would render the whole file as additions — features/file-explorer-
 * improvements.md § 9, "Decision (2026-08-03)"); staying *silent* about it was the defect.
 */

/** Append a closed-diff-tab count to a move/rename status line. `0` leaves `text` unchanged. */
export function withClosedDiffs(text: string, closedDiffs: number): string {
  if (closedDiffs === 0) return text;
  const noun = closedDiffs === 1 ? "diff tab" : "diff tabs";
  return `${text} — closed ${closedDiffs} ${noun}`;
}
