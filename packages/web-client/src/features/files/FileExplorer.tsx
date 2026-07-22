/**
 * FileExplorer — right-sidebar Files tab (POC `loadFiles`/`renderRightPanel`, chat.html
 * ~line 1014-1053, POC_TO_APP_PLAN_UI.md §4.7). Breadcrumb-style nav: an "up" row while below the
 * active workspace's root — navigation is clamped there, this is a workspace file browser, not a
 * general filesystem one — then directories (alphabetical) before files (alphabetical). Directory
 * click navigates in place; file click opens a file tab. A header row uploads local files into the
 * current directory (button or drag-and-drop); each file row can be saved back to disk. Uploads and
 * downloads ride the binary file-transfer frames (features/file-explorer-transfer.md).
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Folder, File as FileIcon, ArrowUp, Upload, MoreVertical } from "lucide-react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useExplorerStore, resolveTildePath } from "@pi-studio-ui/stores/explorer-store.js";
import { useExplorer } from "@pi-studio-ui/hooks/use-explorer.js";
import { useFileTransfer } from "@pi-studio-ui/hooks/use-file-transfer.js";
import { useTabStore, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { FileContextMenu } from "./FileContextMenu.js";
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
  const { upload } = useFileTransfer();
  const openFileMenu = useUiStore((s) => s.openFileMenu);

  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function uploadFiles(files: File[]) {
    if (!files.length || !currentPath) return;
    const existing = new Set(data?.entries.map((e) => e.name) ?? []);
    const clashes = files.filter((f) => existing.has(f.name));
    if (clashes.length > 0) {
      const names = clashes.map((f) => f.name).join(", ");
      if (!window.confirm(`Overwrite ${clashes.length > 1 ? "these files" : "this file"}? ${names}`)) {
        return;
      }
    }

    setStatus({ text: `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`, error: false });
    try {
      for (const file of files) await upload(currentPath, file);
      setStatus({
        text: `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`,
        error: false,
      });
    } catch (e) {
      setStatus({ text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}`, error: true });
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    void uploadFiles(files);
  }

  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  if (!client) {
    return <div className={styles.emptyState}>Connect to browse files</div>;
  }

  return (
    <div
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={!currentPath}
          title="Upload files to this folder"
        >
          <Upload size={12} />
          <span>Upload</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={styles.hiddenInput}
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {status && (
        <div className={status.error ? styles.statusError : styles.status}>{status.text}</div>
      )}

      <div className={styles.list}>
        {currentPath && currentPath !== rootPath && (
          <div className={styles.upRow} onClick={() => goUp()}>
            <ArrowUp size={12} />
            <span>{currentPath}</span>
          </div>
        )}
        {isLoading && <div className={styles.emptyState}>Loading...</div>}
        {isError && (
          <div className={styles.emptyState}>
            Error: {error instanceof Error ? error.message : "unknown error"}
          </div>
        )}
        {!isLoading && !isError && (!data || data.entries.length === 0) && (
          <div className={styles.emptyState}>No files loaded</div>
        )}
        {data?.entries.map((entry) => {
          const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
          return (
            <div
              key={entry.name}
              className={styles.item}
              onClick={() =>
                entry.kind === "directory" ? handleDirClick(entry.name) : handleFileClick(entry.name)
              }
              onContextMenu={(e) => {
                e.preventDefault();
                openFileMenu(fullPath, entry.kind === "directory", e.clientX, e.clientY);
              }}
            >
              <span className={styles.icon}>
                {entry.kind === "directory" ? <Folder size={14} /> : <FileIcon size={14} />}
              </span>
              <span className={entry.kind === "directory" ? styles.dirName : styles.name}>
                {entry.name}
              </span>
              <button
                type="button"
                className={styles.rowAction}
                title="Actions"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  openFileMenu(fullPath, entry.kind === "directory", rect.left, rect.bottom);
                }}
              >
                <MoreVertical size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {dragging && <div className={styles.dropOverlay}>Drop to upload</div>}
      <FileContextMenu />
    </div>
  );
}
