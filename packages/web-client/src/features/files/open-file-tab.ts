/**
 * Shared "open a path as a tab" dispatch — used by the Files tree's row click (`FileExplorer.tsx`)
 * and the file context menu's "Open" action (`FileContextMenu.tsx`) so both mint identical tab
 * ids/labels and agree on the molecule-vs-plain-file kind (`viewer-registry.ts#isMoleculeFile`).
 */

import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { isMoleculeFile } from "./viewer-registry.js";

export function openFileTab(path: string, workspaceCwd: string): void {
  if (isMoleculeFile(path)) {
    openMoleculeTab(path, workspaceCwd);
    return;
  }
  const label = path.split("/").pop() || path;
  useTabStore.getState().open({
    id: tabIds.file(path),
    kind: "file",
    label,
    closable: true,
    data: { path },
    workspaceCwd,
  });
}

/**
 * Force-open a file as a molecule tab, regardless of whether `isMoleculeFile` recognizes it.
 * Used by the file context menu's "Open in MolViewer" action so the user can hand any file to
 * molviewer (e.g. a LAMMPS `data` file that moleviewer's readers can still parse, but whose
 * extension isn't in `MOLECULE_EXTENSIONS`).
 */
export function openMoleculeTab(path: string, workspaceCwd: string): void {
  const label = path.split("/").pop() || path;
  useTabStore.getState().open({
    id: tabIds.molecule(path),
    kind: "molecule",
    label,
    closable: true,
    data: { path },
    workspaceCwd,
  });
}
