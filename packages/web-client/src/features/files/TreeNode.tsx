/**
 * TreeNode — one row of the Files tab tree view (POC_TO_APP_PLAN_UI.md §4.7 tree-view follow-up).
 * Presentational only: `FileExplorer.tsx` computes the flattened `TreeRow[]` (`file-tree.ts`) and
 * hands each one here as a fixed-height virtualized row. A directory row toggles expansion; a
 * file row opens a tab; both show the "⋮" action button feeding the shared `FileContextMenu`.
 */

import { ChevronRight, Folder, File as FileIcon, MoreVertical } from "lucide-react";
import { clsx } from "clsx";
import type { TreeRow } from "./file-tree.js";
import { TreeDraftRow } from "./TreeDraftRow.js";
import styles from "./FileExplorer.module.css";

export interface TreeNodeProps {
  row: TreeRow;
  onToggle(path: string): void;
  onOpenFile(path: string): void;
  onContextMenu(path: string, isDirectory: boolean, x: number, y: number): void;
  onSubmitDraft(parentPath: string, name: string): void;
  onCancelDraft(): void;
}

const INDENT_PX = 14;

export function TreeNode({
  row,
  onToggle,
  onOpenFile,
  onContextMenu,
  onSubmitDraft,
  onCancelDraft,
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
      className={styles.item}
      style={indent}
      onClick={() => (isDirectory ? onToggle(row.path) : onOpenFile(row.path))}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(row.path, isDirectory, e.clientX, e.clientY);
      }}
    >
      <span className={styles.chevronSlot}>
        {isDirectory && (
          <ChevronRight
            size={12}
            className={clsx(styles.chevron, row.expanded && styles.chevronOpen)}
          />
        )}
      </span>
      <span className={styles.icon}>
        {isDirectory ? <Folder size={14} /> : <FileIcon size={14} />}
      </span>
      <span className={isDirectory ? styles.dirName : styles.name}>{row.name}</span>
      <button
        type="button"
        className={styles.rowAction}
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onContextMenu(row.path, isDirectory, rect.left, rect.bottom);
        }}
      >
        <MoreVertical size={12} />
      </button>
    </div>
  );
}
