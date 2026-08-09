/**
 * MoleculeViewerPanel — thin `PanelProps` adapter for a `kind: "molecule"` tab. No header, no
 * File/Diff toggle (a molecule tab has neither — diffs come from the git Changes panel
 * independently, `ChangesPanel.tsx`); it owns the panel-filling height chain and hands off to
 * `MoleculeViewer` for everything else.
 */

import { useIsTabVisible, type MoleculeTabData } from "@pi-studio-ui/stores/tab-store.js";
import type { PanelProps } from "@pi-studio-ui/features/workspace/panel-registry.js";
import { Panel } from "@pi-studio-ui/components/primitives/Panel.js";
import { MoleculeViewer } from "./MoleculeViewer.js";

export function MoleculeViewerPanel({ tab }: PanelProps) {
  const { path } = tab.data as MoleculeTabData;
  // Per-pane visibility: a molecule tab in a non-focused pane is still on screen and must resize.
  const isActive = useIsTabVisible(tab.id);

  return (
    <Panel>
      <MoleculeViewer
        path={path}
        workspaceCwd={tab.workspaceCwd}
        tabId={tab.id}
        isActive={isActive}
      />
    </Panel>
  );
}
