/**
 * FilePanel — the file/diff view toggle panel (POC `buildFilePanel`/`buildDiffPanel` +
 * `loadFileContent`/`loadDiffContent`, chat.html ~line 800-900, POC_TO_APP_PLAN_UI.md §4.5).
 * `panel-registry.ts` mounts this component for BOTH `kind:"file"` and `kind:"diff"` tabs — a
 * `kind:"file"` tab defaults to the File view, a `kind:"diff"` tab defaults to the Diff view.
 * Both views stay toggleable within the same panel via local `viewMode` state (not tab-store
 * state), matching the POC's per-panel `showFile`/`showDiff` toggle.
 *
 * The File view dispatches through the modular viewer registry (`viewer-registry.ts`):
 * `detectViewerKind` picks a viewer from the path's extension, and `VIEWER_BY_KIND` resolves the
 * (lazily-loaded) component — text/markdown/image/video today, more by adding one registry entry.
 *
 * Live updates come from the daemon's filesystem watcher via `useFileLiveRefresh` (not the
 * debounced post-tool-call invalidation in `lib/connection/files-changed.ts`, which stays as the
 * fallback for files nobody has open): only `text`/`markdown`/`image` kinds are watched — a video
 * refetch would restart playback from zero, and the binary fallback fetches nothing eagerly, so
 * there is nothing to refresh. Molecule tabs are deliberately NOT covered here — they mount
 * `MoleculeViewerPanel` elsewhere, whose `MoleculeViewer` keeps its own `shouldApplyRefresh`
 * unsaved-edits gate that this generic invalidation would bypass.
 */

import { Suspense, useState } from "react";
import { clsx } from "clsx";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { Panel } from "@pi-studio-ui/components/primitives/Panel.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useFileDiff } from "@pi-studio-ui/hooks/use-file-diff.js";
import { useFileLiveRefresh } from "@pi-studio-ui/hooks/use-file-live-refresh.js";
import type { Tab, FileTabData, DiffTabData } from "@pi-studio-ui/stores/tab-store.js";
import { DiffView } from "./DiffView.js";
import { detectViewerKind, VIEWER_BY_KIND } from "./viewer-registry.js";
import styles from "./FilePanel.module.css";

type ViewMode = "file" | "diff";

function hasPath(data: Tab["data"]): data is FileTabData | DiffTabData {
  return "path" in data;
}

function isDiffTabData(data: FileTabData | DiffTabData): data is DiffTabData {
  return "staged" in data;
}

export interface FilePanelProps {
  tab: Tab;
}

export function FilePanel({ tab }: FilePanelProps) {
  const isDiffTab = tab.kind === "diff";
  const data = tab.data;
  const path = hasPath(data) ? data.path : "";
  const staged = hasPath(data) && isDiffTabData(data) ? data.staged : false;

  const [viewMode, setViewMode] = useState<ViewMode>(isDiffTab ? "diff" : "file");
  const cwd = tab.workspaceCwd || "~";
  const viewerKind = detectViewerKind(path);
  useFileLiveRefresh(path, cwd, viewerKind);

  const diffQuery = useFileDiff(path, cwd, staged, viewMode === "diff");

  const Viewer = VIEWER_BY_KIND[viewerKind];

  return (
    <Panel>
      <div className={styles.header}>
        <span className={styles.path}>{path}</span>
        <span className={styles.size}>
          {viewMode === "diff" ? (staged ? "staged" : "unstaged") : null}
        </span>
        <div className={styles.viewToggle}>
          <Button
            size="xs"
            variant={viewMode === "file" ? "default" : "ghost"}
            onClick={() => setViewMode("file")}
          >
            File
          </Button>
          <Button
            size="xs"
            variant={viewMode === "diff" ? "default" : "ghost"}
            onClick={() => setViewMode("diff")}
          >
            Diff
          </Button>
        </div>
      </div>
      <div className={clsx(styles.body, "file-body")}>
        {viewMode === "file" ? (
          <Suspense
            fallback={
              <EmptyState>
                <Spinner size="sm" /> Loading...
              </EmptyState>
            }
          >
            <Viewer path={path} />
          </Suspense>
        ) : diffQuery.isLoading ? (
          <EmptyState>
            <Spinner size="sm" /> Loading diff...
          </EmptyState>
        ) : diffQuery.isError ? (
          <EmptyState>
            Error: {diffQuery.error instanceof Error ? diffQuery.error.message : "unknown error"}
          </EmptyState>
        ) : diffQuery.data?.patch ? (
          <DiffView patch={diffQuery.data.patch} />
        ) : (
          <EmptyState style={{ padding: "var(--pi-spacing-30)" }}>
            No changes (file matches HEAD)
          </EmptyState>
        )}
      </div>
    </Panel>
  );
}
