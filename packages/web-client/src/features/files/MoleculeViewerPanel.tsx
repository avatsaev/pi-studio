/**
 * MoleculeViewerPanel — thin `PanelProps` adapter for a `kind: "molecule"` tab. No header, no
 * File/Diff toggle (a molecule tab has neither — diffs come from the git Changes panel
 * independently, `ChangesPanel.tsx`); it owns the panel-filling height chain and hands off to
 * `MoleculeViewer` for everything else.
 */

import { useTabStore, type MoleculeTabData } from "@pi-studio-ui/stores/tab-store.js";
import type { PanelProps } from "@pi-studio-ui/features/workspace/panel-registry.js";
import { MoleculeViewer } from "./MoleculeViewer.js";
import styles from "./MoleculeViewerPanel.module.css";

export function MoleculeViewerPanel({ tab }: PanelProps) {
  const { path } = tab.data as MoleculeTabData;
  const activeTabId = useTabStore((s) => s.activeTabId);
  const isActive = activeTabId === tab.id;

  return (
    <div className={styles.panel}>
      <MoleculeViewer path={path} isActive={isActive} />
    </div>
  );
}
