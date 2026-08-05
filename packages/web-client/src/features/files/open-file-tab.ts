/**
 * Shared "open a path as a tab" dispatch — used by the Files tree's row click (`FileExplorer.tsx`),
 * the file context menu's "Open" action (`FileContextMenu.tsx`), and a Files-tree-to-pane drag
 * (`use-external-pane-drop.ts`) so they all mint identical tab ids/labels and agree on the
 * molecule-vs-plain-file kind (`viewer-registry.ts#isMoleculeFile`). Either side of that dispatch
 * can also be forced directly — `openMoleculeTab`/`openTextTab` below — for the file context
 * menu's "Open in MolViewer" / "Open as Text" actions.
 *
 * `targetPaneId` places the tab in a named pane — the pane a drop landed on, or the one a split just
 * created; omitted, it lands in the focused pane. Same contract as `openNewTerminal`/`openNewChat`.
 */

import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { isMoleculeFile } from "./viewer-registry.js";

export function openFileTab(path: string, workspaceCwd: string, targetPaneId?: string): void {
  if (isMoleculeFile(path)) openMoleculeTab(path, workspaceCwd, targetPaneId);
  else openTextTab(path, workspaceCwd, targetPaneId);
}

/**
 * Open a path as a plain `kind: "file"` tab (`FilePanel` + the viewer registry), skipping the
 * molecule dispatch above. Used by `openFileTab` for every non-molecule path, and directly by the
 * context menu's "Open as Text" action so a molecule file can be read as source instead of
 * rendered — the mirror image of `openMoleculeTab`. Both tabs can be open on one path at once:
 * `tabIds.file` and `tabIds.molecule` are separate id namespaces.
 *
 * This forces the tab *kind* only. Which viewer mounts inside `FilePanel` remains
 * `detectViewerKind`'s call — every molecule extension (and POSCAR/CONTCAR) falls through to
 * `TextViewer`, which is what makes this action meaningful for exactly those files.
 */
export function openTextTab(path: string, workspaceCwd: string, targetPaneId?: string): void {
  const label = path.split("/").pop() || path;
  useTabStore.getState().open(
    {
      id: tabIds.file(path),
      kind: "file",
      label,
      closable: true,
      data: { path },
      workspaceCwd,
    },
    targetPaneId,
  );
}

/**
 * Force-open a file as a molecule tab, regardless of whether `isMoleculeFile` recognizes it.
 * Used by the file context menu's "Open in MolViewer" action so the user can hand any file to
 * molviewer (e.g. a LAMMPS `data` file that moleviewer's readers can still parse, but whose
 * extension isn't in `MOLECULE_EXTENSIONS`).
 */
export function openMoleculeTab(path: string, workspaceCwd: string, targetPaneId?: string): void {
  const label = path.split("/").pop() || path;
  useTabStore.getState().open(
    {
      id: tabIds.molecule(path),
      kind: "molecule",
      label,
      closable: true,
      data: { path },
      workspaceCwd,
    },
    targetPaneId,
  );
}
