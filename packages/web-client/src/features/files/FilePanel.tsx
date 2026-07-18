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
 */

import { Suspense, useState } from "react";
import { clsx } from "clsx";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useFileDiff } from "@pi-studio-ui/hooks/use-file-diff.js";
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

  const diffQuery = useFileDiff(path, cwd, staged, viewMode === "diff");

  const viewerKind = detectViewerKind(path);
  const Viewer = VIEWER_BY_KIND[viewerKind];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.path}>{path}</span>
        <span className={styles.size}>{viewMode === "diff" ? (staged ? "staged" : "unstaged") : null}</span>
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
          <Suspense fallback={<div className={styles.emptyState}><Spinner size="sm" /> Loading...</div>}>
            <Viewer path={path} />
          </Suspense>
        ) : diffQuery.isLoading ? (
          <div className={styles.emptyState}>
            <Spinner size="sm" /> Loading diff...
          </div>
        ) : diffQuery.isError ? (
          <div className={styles.emptyState}>
            Error: {diffQuery.error instanceof Error ? diffQuery.error.message : "unknown error"}
          </div>
        ) : diffQuery.data?.patch ? (
          <DiffView patch={diffQuery.data.patch} />
        ) : (
          <div className={styles.diffEmpty}>No changes (file matches HEAD)</div>
        )}
      </div>
    </div>
  );
}
