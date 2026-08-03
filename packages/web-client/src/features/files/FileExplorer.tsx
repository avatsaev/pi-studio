/**
 * FileExplorer — right-sidebar Files tab, tree view (POC `loadFiles`/`renderRightPanel`,
 * chat.html ~line 1014-1053, POC_TO_APP_PLAN_UI.md §4.7 — superseded the original breadcrumb-
 * style single-directory browser with a lazy-loading tree). Each expanded directory fetches its
 * own listing (`useExplorerTree`, one `file_explorer_request` per expanded path); `file-tree.ts`
 * flattens root + expansion set + per-path listings into the ordered row list rendered here
 * through `@tanstack/react-virtual` (same virtualizer pattern as `Timeline.tsx`). Directory click
 * toggles expand/collapse in place; file click opens a file tab. Rows are drag sources for an
 * internal move/rename (`file_move_request`, sprint-046) — dragging a row onto a directory (or
 * file, which targets its parent) moves it there. Dragging files in from the OS uploads them into
 * the hovered row's directory (same highlight + 700ms auto-expand as an internal move,
 * `resolveUploadTarget` in move-target.ts) or the workspace root when dropped on empty space or
 * the header's "Upload" button; `dataTransfer.types` — `"Files"` vs the internal
 * `application/x-pi-studio-path` MIME — discriminates the two drag kinds before any per-row state
 * is touched, so a stale internal-drag ref can never hijack an OS-file drop into the wrong
 * directory (or vice versa). Each row can be saved back to disk via its "⋮" menu. Downloads ride
 * the binary file-transfer frames (features/file-explorer-transfer.md).
 */

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, FilePlus, FolderPlus } from "lucide-react";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useExplorerStore, resolveTildePath } from "@pi-studio-ui/stores/explorer-store.js";
import { useExplorerTree } from "@pi-studio-ui/hooks/use-explorer-tree.js";
import { useExplorerWatch } from "@pi-studio-ui/hooks/use-explorer-watch.js";
import { useFileTransfer } from "@pi-studio-ui/hooks/use-file-transfer.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import type { DiffTabData, FileTabData, MoleculeTabData } from "@pi-studio-ui/stores/tab-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { useGitStore } from "@pi-studio-ui/stores/git-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { dirOf } from "@pi-studio-ui/lib/paths.js";
import { resolveMoveTarget, resolveUploadTarget } from "./move-target.js";
import { moveEntry } from "./move-entry.js";
import { withClosedDiffs } from "./move-status.js";
import { flattenTree, joinPath } from "./file-tree.js";
import { buildGitStatusLookup, buildIgnoredMatcher } from "./git-status-index.js";
import { TreeNode } from "./TreeNode.js";
import { FileContextMenu } from "./FileContextMenu.js";
import { createEntry } from "./create-entry.js";
import { openFileTab } from "./open-file-tab.js";
import styles from "./FileExplorer.module.css";

const ROW_HEIGHT_PX = 28;
/** MIME type discriminating an internal row drag from an OS-file drag — `dataTransfer` exposes
 *  the type *list* during `dragover` but not the *value* (protected mode), so this is the only
 *  signal available before drop. */
const MOVE_MIME = "application/x-pi-studio-path";
/** Standard `dataTransfer.types` entry present whenever the OS drag payload includes files —
 *  browsers populate `types` with this during dragenter/dragover but only expose the actual
 *  `dataTransfer.files` list at drop. */
const OS_FILE_TYPE = "Files";

export function FileExplorer() {
  const client = useConnectionStore((s) => s.client);
  const rootPath = useExplorerStore((s) => s.rootPath);
  const expanded = useExplorerStore((s) => s.expanded);
  const setRoot = useExplorerStore((s) => s.setRoot);
  const toggle = useExplorerStore((s) => s.toggle);
  const draft = useExplorerStore((s) => s.draft);
  const startDraft = useExplorerStore((s) => s.startDraft);
  const cancelDraft = useExplorerStore((s) => s.cancelDraft);
  const renaming = useExplorerStore((s) => s.renaming);
  const cancelRename = useExplorerStore((s) => s.cancelRename);
  const selected = useExplorerStore((s) => s.selected);
  const setSelected = useExplorerStore((s) => s.setSelected);
  // The workspace currently in view in the tab strip drives what Files/Changes browse — same
  // authoritative signal every tab creation site uses (§4.7 follow-up: workspace-scoped tabs).
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const activeTab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  // Live checkout status for the active workspace — `StatusBar` owns the subscription, so this is
  // a pure read; the tree tints rows from it and ghosts ignored ones (no extra RPC).
  const changes = useGitStore((s) => s.changes);
  const ignored = useGitStore((s) => s.ignored);
  const { upload } = useFileTransfer();
  const openFileMenu = useUiStore((s) => s.openFileMenu);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  // The row currently highlighted as the drop target.
  const [dropTargetRowPath, setDropTargetRowPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Path of the row currently being dragged — `dataTransfer.getData()` returns "" during
  // dragover/dragenter in every browser (only dragstart/drop can read it), so target validation
  // needs the source path held in a ref instead.
  const dragSourceRef = useRef<string | null>(null);
  // Pending "expand this collapsed directory after 700ms of hover" timer, mid-drag.
  const autoExpandRef = useRef<{ path: string; timer: number } | null>(null);

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
    () => flattenTree(rootPath, expanded, tree, draft, renaming),
    [rootPath, expanded, tree, draft, renaming],
  );
  const gitStatusOf = useMemo(() => buildGitStatusLookup(rootPath, changes), [rootPath, changes]);
  const isIgnored = useMemo(() => buildIgnoredMatcher(rootPath, ignored), [rootPath, ignored]);

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

  function handleDragStartRow(path: string, e: DragEvent) {
    e.dataTransfer.setData(MOVE_MIME, path);
    e.dataTransfer.effectAllowed = "move";
    dragSourceRef.current = path;
  }

  function handleDragEndRow() {
    dragSourceRef.current = null;
  }

  function clearDropState() {
    setDropTargetRowPath(null);
    if (autoExpandRef.current) {
      clearTimeout(autoExpandRef.current.timer);
      autoExpandRef.current = null;
    }
  }

  function scheduleAutoExpand(row: { kind: string; path: string; expanded?: boolean }) {
    if (autoExpandRef.current?.path === row.path) return;
    if (autoExpandRef.current) clearTimeout(autoExpandRef.current.timer);
    autoExpandRef.current = null;
    if (row.kind !== "directory" || row.expanded) return;
    const timer = window.setTimeout(() => toggle(row.path), 700);
    autoExpandRef.current = { path: row.path, timer };
  }

  /** Issue the move, then reconcile caches, tree state, and tabs — shared by drag-move and
   *  rename (task-002: extracted before rename, its second caller, exists so the two can never
   *  drift). The daemon's echoed `destination` is authoritative from here on: after the
   *  trimmed-basename fix it may legitimately differ from what was requested, and repathing or
   *  reopening the client-computed path instead would target a path that no longer exists. */
  async function applyMove(
    source: string,
    requestedDestination: string,
  ): Promise<{ destination: string; closedDiffs: number }> {
    if (!client) throw new Error("Not connected.");
    const destination = await moveEntry(client, source, requestedDestination);
    const destinationDir = dirOf(destination);
    await queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(dirOf(source)) });
    await queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(destinationDir) });
    useExplorerStore.getState().repathAfterMove(source, destination, destinationDir);

    // Partition BEFORE closing — closeByPathPrefix removes the matching tabs, so counting
    // afterwards would always read 0. Same predicate closeByPathPrefix uses, so diff tabs under
    // a renamed/moved directory are counted too (the recorded decision: "the same count covers
    // them").
    const matches = useTabStore.getState().tabs.filter((t) => {
      if (t.kind !== "file" && t.kind !== "diff" && t.kind !== "molecule") return false;
      const path = (t.data as FileTabData | DiffTabData | MoleculeTabData).path;
      return path === source || (path?.startsWith(`${source}/`) ?? false);
    });
    const hadTab = matches.some(
      (t) =>
        (t.kind === "file" || t.kind === "molecule") &&
        (t.data as FileTabData | MoleculeTabData).path === source,
    );
    const closedDiffs = matches.filter((t) => t.kind === "diff").length;

    useTabStore.getState().closeByPathPrefix(source);
    if (hadTab) handleOpenFile(destination);

    return { destination, closedDiffs };
  }

  async function moveDropped(source: string, row: { kind: string; path: string }) {
    const target = resolveMoveTarget(source, row, rootPath);
    if (!target || !client) return;
    const basename = source.split("/").pop() ?? source;
    setStatus({ text: `Moving ${basename}…`, error: false });
    try {
      const { destination, closedDiffs } = await applyMove(source, target.destination);
      setStatus({
        text: withClosedDiffs(
          `Moved to ${dirOf(destination).split("/").pop() || "/"}`,
          closedDiffs,
        ),
        error: false,
      });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : "Failed to move", error: true });
    }
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

  async function submitRename(path: string, newName: string) {
    cancelRename();
    if (!client) return;
    // Same-parent move — deliberately NOT `resolveMoveTarget`, which returns `null` for a
    // same-directory destination (correct for drag: dropping a row into its own folder is a
    // no-op; fatal here). All rename legality is decided server-side by `moveEntry`.
    const destination = joinPath(dirOf(path), newName);
    setStatus({ text: `Renaming ${path.split("/").pop()}…`, error: false });
    try {
      const { destination: finalPath, closedDiffs } = await applyMove(path, destination);
      setStatus({
        text: withClosedDiffs(`Renamed to ${finalPath.split("/").pop()}`, closedDiffs),
        error: false,
      });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : "Failed to rename", error: true });
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

  function handleDrop(e: DragEvent, row?: { kind: string; path: string }) {
    e.preventDefault();
    // `dataTransfer.types` is the one signal fully owned by the browser for the CURRENT drag —
    // it can't go stale the way an app-managed ref could (e.g. a `dragend` that never fired for a
    // prior attempt) — so it alone decides which branch below runs, never `dragSourceRef` first.
    if (e.dataTransfer.types.includes(MOVE_MIME)) {
      const source = e.dataTransfer.getData(MOVE_MIME) || dragSourceRef.current;
      clearDropState();
      if (source) void moveDropped(source, row ?? { kind: "directory", path: rootPath });
      return;
    }
    clearDropState();
    if (!e.dataTransfer.types.includes(OS_FILE_TYPE)) return;
    const dir = row ? resolveUploadTarget(row, rootPath) : rootPath;
    if (!dir) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void uploadFiles(dir, files);
  }

  function handleDragOver(e: DragEvent) {
    const isInternalMove = e.dataTransfer.types.includes(MOVE_MIME);
    if (!isInternalMove && !e.dataTransfer.types.includes(OS_FILE_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isInternalMove ? "move" : "copy";
  }

  if (!client) {
    return <EmptyState>Connect to browse files</EmptyState>;
  }

  return (
    <div
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        // `dragleave` mirrors `mouseout`, not `mouseleave` — it bubbles and refires on every
        // child-element boundary crossing, including moving between two spans inside the SAME
        // row. Without this guard, every such micro-crossing bubbles here and wipes the
        // just-set highlight a tick after `onDragEnter` set it — the "flashes once, then goes
        // dark" symptom. Only clear when the drag is actually leaving the whole panel, i.e. the
        // element being entered next is outside this container.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        clearDropState();
      }}
      onDrop={(e) => handleDrop(e)}
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
          <FilePlus size={14} />
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
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={() => fileInputRef.current?.click()}
          disabled={!rootPath}
          title="Upload files to the workspace root"
        >
          <Upload size={14} />
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
        {rows.length === 0 && <EmptyState>No files loaded</EmptyState>}
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
                onDragEnter={(e) => {
                  // Gate on `dataTransfer.types`, not just the ref — see `handleDrop`'s comment.
                  if (e.dataTransfer.types.includes(MOVE_MIME)) {
                    const source = dragSourceRef.current;
                    if (!source) return;
                    const target = resolveMoveTarget(source, row, rootPath);
                    setDropTargetRowPath(target ? row.path : null);
                    scheduleAutoExpand(row);
                    return;
                  }
                  if (!e.dataTransfer.types.includes(OS_FILE_TYPE)) return;
                  const target = resolveUploadTarget(row, rootPath);
                  setDropTargetRowPath(target ? row.path : null);
                  scheduleAutoExpand(row);
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  handleDrop(e, row);
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
                  gitStatus={
                    row.kind === "file" || row.kind === "directory"
                      ? gitStatusOf(row.path)
                      : undefined
                  }
                  hidden={
                    (row.kind === "file" || row.kind === "directory") &&
                    (row.name.startsWith(".") || isIgnored(row.path))
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
                  onSubmitRename={(path, name) => void submitRename(path, name)}
                  onCancelRename={cancelRename}
                  onDragStartRow={handleDragStartRow}
                  onDragEndRow={handleDragEndRow}
                  dropTarget={
                    (row.kind === "file" || row.kind === "directory") &&
                    row.path === dropTargetRowPath
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      <FileContextMenu />
    </div>
  );
}
