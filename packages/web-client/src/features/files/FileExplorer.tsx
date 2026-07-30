/**
 * FileExplorer — right-sidebar Files tab, tree view (POC `loadFiles`/`renderRightPanel`,
 * chat.html ~line 1014-1053, POC_TO_APP_PLAN_UI.md §4.7 — superseded the original breadcrumb-
 * style single-directory browser with a lazy-loading tree). Each expanded directory fetches its
 * own listing (`useExplorerTree`, one `file_explorer_request` per expanded path); `file-tree.ts`
 * flattens root + expansion set + per-path listings into the ordered row list rendered here
 * through `@tanstack/react-virtual` (same virtualizer pattern as `Timeline.tsx`). Directory click
 * toggles expand/collapse in place; file click opens a file tab. A header row uploads local files
 * into the current directory (button or drag-and-drop, resolved from the row dropped onto, or the
 * workspace root otherwise); each row can be saved back to disk via its "⋮" menu. Uploads and
 * downloads ride the binary file-transfer frames (features/file-explorer-transfer.md).
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, FilePlus, FolderPlus } from "lucide-react";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useExplorerStore, resolveTildePath } from "@pi-studio-ui/stores/explorer-store.js";
import { useExplorerTree } from "@pi-studio-ui/hooks/use-explorer-tree.js";
import { useExplorerWatch } from "@pi-studio-ui/hooks/use-explorer-watch.js";
import { useFileTransfer } from "@pi-studio-ui/hooks/use-file-transfer.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import type { FileTabData, MoleculeTabData } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { dirOf } from "@pi-studio-ui/lib/paths.js";
import { flattenTree } from "./file-tree.js";
import { TreeNode } from "./TreeNode.js";
import { FileContextMenu } from "./FileContextMenu.js";
import { createEntry } from "./create-entry.js";
import { openFileTab } from "./open-file-tab.js";
import styles from "./FileExplorer.module.css";

const ROW_HEIGHT_PX = 24;

export function FileExplorer() {
  const client = useConnectionStore((s) => s.client);
  const rootPath = useExplorerStore((s) => s.rootPath);
  const expanded = useExplorerStore((s) => s.expanded);
  const setRoot = useExplorerStore((s) => s.setRoot);
  const toggle = useExplorerStore((s) => s.toggle);
  const draft = useExplorerStore((s) => s.draft);
  const startDraft = useExplorerStore((s) => s.startDraft);
  const cancelDraft = useExplorerStore((s) => s.cancelDraft);
  const selected = useExplorerStore((s) => s.selected);
  const setSelected = useExplorerStore((s) => s.setSelected);
  // The workspace currently in view in the tab strip drives what Files/Changes browse — same
  // authoritative signal every tab creation site uses (§4.7 follow-up: workspace-scoped tabs).
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const { upload } = useFileTransfer();
  const openFileMenu = useUiStore((s) => s.openFileMenu);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The path of the file/molecule tab currently in view, for the active-row highlight (item 6) —
  // null for chat/terminal/diff tabs, or when nothing's active.
  const activeFilePath =
    activeTab?.kind === "file" || activeTab?.kind === "molecule"
      ? (activeTab.data as FileTabData | MoleculeTabData).path
      : null;

  // Where the header's "New File"/"New Folder" buttons create their entry: the selected
  // directory, or the selected file's parent — falls back to `rootPath`. The empty-space
  // context menu deliberately does NOT use this — it always targets `rootPath` (right-clicking
  // below the last row means "here, at the root", regardless of what's still selected above).
  const createTargetDir = selected
    ? selected.isDirectory
      ? selected.path
      : dirOf(selected.path)
    : rootPath;

  // Re-root whenever the active workspace changes, and seed it once on first connect.
  // `lastSeededCwd` distinguishes "the active workspace changed" from a re-render — only the
  // former reseeds (and restores that workspace's remembered `expanded` set, see explorer-store).
  const lastSeededCwd = useRef<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const target = activeWorkspaceCwd || "~";
    if (lastSeededCwd.current === target) return;
    lastSeededCwd.current = target;
    void resolveTildePath(client, target).then((resolved) => setRoot(resolved));
  }, [client, activeWorkspaceCwd, setRoot]);

  const tree = useExplorerTree(expanded);
  useExplorerWatch(expanded);
  const rows = useMemo(
    () => flattenTree(rootPath, expanded, tree, draft),
    [rootPath, expanded, tree, draft],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 12,
    getItemKey: (index) => rows[index]?.path ?? index,
  });

  function handleOpenFile(path: string) {
    openFileTab(path, activeWorkspaceCwd || "~");
  }

  async function submitDraft(parentPath: string, name: string) {
    const kind = draft?.kind ?? "file";
    cancelDraft();
    if (!client) return;
    try {
      const created = await createEntry(client, parentPath, name, kind);
      await queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(parentPath) });
      setStatus({ text: `Created ${created}`, error: false });
      if (kind === "file") handleOpenFile(created);
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : "Failed to create", error: true });
    }
  }

  async function uploadFiles(dir: string, files: File[]) {
    if (!files.length || !dir) return;
    const existingListing = tree.get(dir)?.listing;
    const existing = new Set(existingListing?.entries.map((e) => e.name) ?? []);
    const clashes = files.filter((f) => existing.has(f.name));
    if (clashes.length > 0) {
      const names = clashes.map((f) => f.name).join(", ");
      if (
        !window.confirm(`Overwrite ${clashes.length > 1 ? "these files" : "this file"}? ${names}`)
      ) {
        return;
      }
    }

    setStatus({
      text: `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`,
      error: false,
    });
    try {
      for (const file of files) await upload(dir, file);
      setStatus({
        text: `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`,
        error: false,
      });
    } catch (e) {
      setStatus({
        text: `Upload failed: ${e instanceof Error ? e.message : "unknown"}`,
        error: true,
      });
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dir = dropTargetDir ?? rootPath;
    setDropTargetDir(null);
    const files = Array.from(e.dataTransfer.files);
    void uploadFiles(dir, files);
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
          onClick={() => startDraft(createTargetDir, "file")}
          disabled={!rootPath}
          title={
            selected
              ? `New file in ${createTargetDir.split("/").pop() || "/"}`
              : "New file in workspace root"
          }
        >
          <FilePlus size={12} />
        </button>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={() => startDraft(createTargetDir, "directory")}
          disabled={!rootPath}
          title={
            selected
              ? `New folder in ${createTargetDir.split("/").pop() || "/"}`
              : "New folder in workspace root"
          }
        >
          <FolderPlus size={12} />
        </button>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={!rootPath}
          title="Upload files to the workspace root"
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
            void uploadFiles(rootPath, Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {status && (
        <div className={status.error ? styles.statusError : styles.status}>{status.text}</div>
      )}

      <div
        className={styles.list}
        ref={scrollRef}
        onContextMenu={(e) => {
          e.preventDefault();
          openFileMenu(rootPath, true, e.clientX, e.clientY, true);
        }}
      >
        {rows.length === 0 && <div className={styles.emptyState}>No files loaded</div>}
        <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onDragEnter={() => {
                  if (row.kind === "directory") setDropTargetDir(row.path);
                }}
              >
                <TreeNode
                  row={row}
                  active={
                    (row.kind === "file" || row.kind === "directory") && row.path === activeFilePath
                  }
                  selected={
                    (row.kind === "file" || row.kind === "directory") && row.path === selected?.path
                  }
                  onToggle={(path) => {
                    setSelected({ path, isDirectory: true });
                    toggle(path);
                  }}
                  onOpenFile={(path) => {
                    setSelected({ path, isDirectory: false });
                    handleOpenFile(path);
                  }}
                  onContextMenu={(path, isDirectory, x, y) => openFileMenu(path, isDirectory, x, y)}
                  onSubmitDraft={(parentPath, name) => void submitDraft(parentPath, name)}
                  onCancelDraft={cancelDraft}
                />
              </div>
            );
          })}
        </div>
      </div>

      {dragging && <div className={styles.dropOverlay}>Drop to upload</div>}
      <FileContextMenu />
    </div>
  );
}
