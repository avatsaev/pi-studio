/**
 * Resolves the `openFileTab` workspace-cwd/target-pane arguments shared by `FileLink` and
 * `InlineImage`'s converged click-to-open dispatch (features/file-link-rendering.md §
 * Click-to-open pane targeting, features/inline-image-rendering.md § Click-to-open, amended).
 *
 * The owning chat tab's real `workspaceCwd` always wins — `assetBase || "~"` is only a fallback
 * for markdown surfaces rendered outside any tab, where no owning tab exists to name; the chat
 * render path always threads a real `workspaceCwd` (task-002) and never hits the fallback.
 * `owningPaneId`'s `null` (no owning pane yet known, e.g. a tab not yet placed by restore)
 * converts to `undefined`, matching `openFileTab`'s `targetPaneId: string | undefined` contract —
 * `undefined` falls back to whichever pane is currently focused.
 *
 * Pure: no store/hook/network imports, so this file needs no React or client mocks to test.
 */
export function resolveFileOpenTarget(
  assetBase: string | null,
  owningPaneId: string | null,
  workspaceCwd: string | null,
): { workspaceCwd: string; targetPaneId: string | undefined } {
  return {
    workspaceCwd: workspaceCwd ?? (assetBase || "~"),
    targetPaneId: owningPaneId ?? undefined,
  };
}
