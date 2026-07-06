/**
 * LiveGitPane — Git changes pane wired to live daemon data:
 * `checkout_status` (changed files) + `checkout_diff` (per-file diff).
 * Replaces the static INITIAL_DIFF_STATE stub previously rendered in
 * PaneContentRouter.
 *
 * clean-room-scope/features/git-checkout.md, features/feature-panels-ui.md
 */

import { useMemo, useState } from "react";
import { GitChangesPanel } from "./GitPanel.js";
import { DiffViewer } from "./DiffViewer.js";
import { Spinner } from "../primitives/index.js";
import {
  INITIAL_DIFF_STATE,
  gitStatusToDiffFiles,
  type DiffMode,
  type DiffLayout,
} from "../../panels/git-panel.js";
import type { DiffInput } from "../../panels/diff-viewer.js";
import { useGitStatus, useGitDiff } from "../../hooks/use-explorer-hooks.js";
import { useClient } from "../../hooks/client-context.js";

export interface LiveGitPaneProps {
  serverId: string;
  cwd: string | undefined;
}

export function LiveGitPane({ serverId, cwd }: LiveGitPaneProps) {
  const client = useClient();
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const [mode, setMode] = useState<DiffMode>("uncommitted");
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>(undefined);

  const gitClient = client as unknown as Parameters<typeof useGitStatus>[2];
  const status = useGitStatus(serverId, cwd, gitClient);
  const diff = useGitDiff(serverId, cwd, selectedFilePath, gitClient);

  const files = useMemo(() => gitStatusToDiffFiles(status.data ?? {}), [status.data]);

  const sidebarState = {
    ...INITIAL_DIFF_STATE,
    diffMode: mode,
    diffLayout: layout,
    loading: status.isLoading,
    isGitRepo: !status.isError,
    selectedFilePath,
  };

  if (!cwd) {
    return <div style={{ padding: 16, color: "var(--pi-color-foregroundMuted)", fontSize: "var(--pi-font-size-xs)" }}>No workspace directory.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--pi-color-surfaceWorkspace)" }}>
      <div style={{ flex: selectedFilePath ? "0 0 auto" : 1, maxHeight: selectedFilePath ? "40%" : undefined, overflow: "auto", borderBottom: selectedFilePath ? "1px solid var(--pi-color-border)" : undefined }}>
        <GitChangesPanel
          state={sidebarState}
          files={files}
          onModeChange={setMode}
          onLayoutChange={setLayout}
          onRefresh={() => void status.refetch()}
          onFileClick={(path) => setSelectedFilePath(path)}
        />
      </div>
      {selectedFilePath && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {diff.isLoading ? (
            <div style={{ padding: 16, display: "flex", justifyContent: "center" }}><Spinner size="sm" /></div>
          ) : diff.data ? (
            <DiffViewer diff={diff.data as unknown as DiffInput} layout={layout} />
          ) : (
            <div style={{ padding: 16, color: "var(--pi-color-foregroundMuted)", fontSize: "var(--pi-font-size-xs)" }}>
              Select a file to view its diff.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
