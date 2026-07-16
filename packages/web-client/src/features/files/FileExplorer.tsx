/**
 * FileExplorer — right-sidebar Files tab (POC `loadFiles`/`renderRightPanel`, chat.html
 * ~line 1014-1053, POC_TO_APP_PLAN_UI.md §4.7). Breadcrumb-style nav: an "up" row while below the
 * active workspace's root — navigation is clamped there, this is a workspace file browser, not a
 * general filesystem one — then directories (alphabetical) before files (alphabetical). Directory
 * click navigates in place; file click opens a file tab.
 */

import { useEffect, useRef } from "react";
import { Folder, File as FileIcon, ArrowUp } from "lucide-react";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useExplorerStore, resolveTildePath } from "../../stores/explorer-store.js";
import { useExplorer } from "../../hooks/use-explorer.js";
import { useTabStore, tabIds } from "../../stores/tab-store.js";
import styles from "./FileExplorer.module.css";

export function FileExplorer() {
  const client = useConnectionStore((s) => s.client);
  const currentPath = useExplorerStore((s) => s.currentPath);
  const rootPath = useExplorerStore((s) => s.rootPath);
  const setPath = useExplorerStore((s) => s.setPath);
  const setRoot = useExplorerStore((s) => s.setRoot);
  const goUp = useExplorerStore((s) => s.goUp);
  // The workspace currently in view in the tab strip drives what Files/Changes browse — same
  // authoritative signal every tab creation site uses (§4.7 follow-up: workspace-scoped tabs).
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const openTab = useTabStore((s) => s.open);

  // Navigate whenever the active workspace changes, and seed it once on first connect. Seeding
  // sets `rootPath` too — the upper navigation boundary — so `goUp()`/the "up" row never let the
  // user browse above the workspace root. `lastSeededCwd` distinguishes "the active workspace
  // changed" from "the user clicked into a subdirectory" — only the former reseeds.
  const lastSeededCwd = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const target = activeWorkspaceCwd || "~";
    if (lastSeededCwd.current === target) return;
    lastSeededCwd.current = target;
    void resolveTildePath(client, target).then((resolved) => setRoot(resolved));
  }, [client, activeWorkspaceCwd, setRoot]);

  const { data, isLoading, isError, error } = useExplorer(currentPath, Boolean(client));

  function handleDirClick(name: string) {
    setPath(currentPath ? `${currentPath}/${name}` : name);
  }

  function handleFileClick(name: string) {
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    openTab({
      id: tabIds.file(fullPath),
      kind: "file",
      label: fullPath.split("/").pop() || fullPath,
      closable: true,
      data: { path: fullPath },
      workspaceCwd: activeWorkspaceCwd || "~",
    });
  }

  if (!client) {
    return <div className={styles.emptyState}>Connect to browse files</div>;
  }
  if (isLoading) {
    return <div className={styles.emptyState}>Loading...</div>;
  }
  if (isError) {
    return (
      <div className={styles.emptyState}>
        Error: {error instanceof Error ? error.message : "unknown error"}
      </div>
    );
  }
  if (!data || data.entries.length === 0) {
    return <div className={styles.emptyState}>No files loaded</div>;
  }

  return (
    <div className={styles.list}>
      {currentPath && currentPath !== rootPath && (
        <div className={styles.upRow} onClick={() => goUp()}>
          <ArrowUp size={12} />
          <span>{currentPath}</span>
        </div>
      )}
      {data.entries.map((entry) => (
        <div
          key={entry.name}
          className={styles.item}
          onClick={() =>
            entry.kind === "directory" ? handleDirClick(entry.name) : handleFileClick(entry.name)
          }
        >
          <span className={styles.icon}>
            {entry.kind === "directory" ? <Folder size={14} /> : <FileIcon size={14} />}
          </span>
          <span className={entry.kind === "directory" ? styles.dirName : styles.name}>
            {entry.name}
          </span>
        </div>
      ))}
    </div>
  );
}
