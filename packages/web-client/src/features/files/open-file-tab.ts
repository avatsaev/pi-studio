/**
 * Shared "open a path as a tab" dispatch — used by the Files tree's row click (`FileExplorer.tsx`)
 * and the file context menu's "Open" action (`FileContextMenu.tsx`) so both mint identical tab
 * ids/labels and agree on the molecule-vs-plain-file kind (`viewer-registry.ts#isMoleculeFile`).
 */

import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { isMoleculeFile } from "./viewer-registry.js";

export function openFileTab(path: string, workspaceCwd: string): void {
  const label = path.split("/").pop() || path;
  if (isMoleculeFile(path)) {
    useTabStore.getState().open({
      id: tabIds.molecule(path),
      kind: "molecule",
      label,
      closable: true,
      data: { path },
      workspaceCwd,
    });
    return;
  }
  useTabStore.getState().open({
    id: tabIds.file(path),
    kind: "file",
    label,
    closable: true,
    data: { path },
    workspaceCwd,
  });
}
