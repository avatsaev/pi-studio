/**
 * TreeNode — one row of the Files tab tree view (POC_TO_APP_PLAN_UI.md §4.7 tree-view follow-up).
 * Presentational only: `FileExplorer.tsx` computes the flattened `TreeRow[]` (`file-tree.ts`) and
 * hands each one here as a fixed-height virtualized row. A directory row toggles expansion; a
 * file row opens a tab; both show the "⋮" action button feeding the shared `FileContextMenu`.
 */

import { ChevronRight, Folder, File as FileIcon, MoreVertical } from "lucide-react";
import { clsx } from "clsx";
import type { TreeRow } from "./file-tree.js";
import type { DragEvent } from "react";
import { IconButton } from "@pi-studio-ui/components/primitives/IconButton.js";
import { TreeDraftRow } from "./TreeDraftRow.js";
import styles from "./FileExplorer.module.css";

export interface TreeNodeProps {
  row: TreeRow;
  /** True when this row's path is the active tab's file (`FileExplorer.tsx`'s `activeFilePath`) —
   * highlighted like the sidebar's active session row. */
  active?: boolean;
  /** True when this row is the last-clicked row (`explorer-store.ts`'s `selected`) — the target
   * directory for "New File"/"New Folder". */
  selected?: boolean;
  /** True while an internal drag would land in this row (`FileExplorer.tsx`'s hovered target). */
  dropTarget?: boolean;
  onToggle(path: string): void;
  onOpenFile(path: string): void;
  onContextMenu(path: string, isDirectory: boolean, x: number, y: number): void;
  onSubmitDraft(parentPath: string, name: string): void;
  onCancelDraft(): void;
  onDragStartRow(path: string, e: DragEvent): void;
  onDragEndRow(): void;
}

const INDENT_PX = 14;

export function TreeNode({
  row,
  active,
  selected,
  dropTarget,
  onToggle,
  onOpenFile,
  onContextMenu,
  onSubmitDraft,
  onCancelDraft,
  onDragStartRow,
  onDragEndRow,
}: TreeNodeProps) {
  const indent = { paddingLeft: 8 + row.depth * INDENT_PX };

  if (row.kind === "loading") {
    return (
      <div className={styles.statusRow} style={indent}>
        Loading…
      </div>
    );
  }
  if (row.kind === "error") {
    return (
      <div className={clsx(styles.statusRow, styles.statusRowError)} style={indent}>
        {row.message ?? "failed to load"}
      </div>
    );
  }
  if (row.kind === "draft") {
    return (
      <TreeDraftRow
        draftKind={row.draftKind}
        indentStyle={indent}
        onSubmit={(name) => onSubmitDraft(row.parentPath, name)}
        onCancel={onCancelDraft}
      />
    );
  }

  const isDirectory = row.kind === "directory";
  return (
    <div
      className={clsx(
        styles.item,
        active && styles.active,
        selected && styles.selected,
        dropTarget && styles.dropTarget,
      )}
      style={indent}
      title={row.path}
      draggable
      onDragStart={(e) => onDragStartRow(row.path, e)}
      onDragEnd={onDragEndRow}
      onClick={() => (isDirectory ? onToggle(row.path) : onOpenFile(row.path))}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(row.path, isDirectory, e.clientX, e.clientY);
      }}
    >
      <span className={styles.chevronSlot}>
        {isDirectory && (
          <ChevronRight
            size={14}
            className={clsx(styles.chevron, row.expanded && styles.chevronOpen)}
          />
        )}
      </span>
      <span className={styles.icon}>
        {isDirectory ? <Folder size={16} /> : <FileIcon size={16} />}
      </span>
      <span className={isDirectory ? styles.dirName : styles.name}>{row.name}</span>
      <IconButton
        className={styles.rowAction}
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onContextMenu(row.path, isDirectory, rect.left, rect.bottom);
        }}
      >
        <MoreVertical size={14} />
      </IconButton>
    </div>
  );
}
