/**
 * Explorer — file tree sidebar (Files tab).
 * feature-panels-ui.md § file explorer
 */

import { useCallback, useMemo } from "react";
import { ChevronRight, File, Folder, RefreshCw, ArrowUpDown } from "lucide-react";
import { clsx } from "clsx";
import styles from "./Explorer.module.css";
import {
  type ExplorerNode,
  type ExplorerState,
  type ExplorerSortMode,
  flattenTree,
  toggleExpand,
  cycleSortMode,
} from "../../panels/file-explorer.js";

export interface ExplorerProps {
  state: ExplorerState;
  onToggleExpand: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRefresh: () => void;
  onCycleSortMode: () => void;
  activePath?: string;
}

export function Explorer({
  state,
  onToggleExpand,
  onOpenFile,
  onRefresh,
  onCycleSortMode,
  activePath,
}: ExplorerProps) {
  const flatRows = useMemo(() => flattenTree(state.root), [state.root]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <span>Files ({state.sortMode})</span>
        <span>
          <button className={styles.toolbarBtn} onClick={onCycleSortMode} aria-label="Cycle sort">
            <ArrowUpDown size={12} />
          </button>
          <button className={styles.toolbarBtn} onClick={onRefresh} aria-label="Refresh">
            <RefreshCw size={12} />
          </button>
        </span>
      </div>
      <div className={styles.tree}>
        {flatRows.length === 0 && <div className={styles.empty}>No files</div>}
        {flatRows.map((node) => (
          <ExplorerRow
            key={node.entry.path}
            node={node}
            active={node.entry.path === activePath}
            onToggle={onToggleExpand}
            onOpen={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}

function ExplorerRow({
  node,
  active,
  onToggle,
  onOpen,
}: {
  node: ExplorerNode;
  active: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const isDir = node.entry.kind === "directory";
  const handleClick = useCallback(() => {
    if (isDir) onToggle(node.entry.path);
    else onOpen(node.entry.path);
  }, [isDir, node.entry.path, onToggle, onOpen]);

  return (
    <div
      className={clsx(styles.row, active && styles.rowActive)}
      style={{ paddingLeft: `${8 + node.depth * 16}px` }}
      onClick={handleClick}
    >
      {isDir ? (
        <span className={clsx(styles.chevron, node.expanded && styles.chevronExpanded)}>
          <ChevronRight size={12} />
        </span>
      ) : (
        <span className={styles.chevron} />
      )}
      {isDir ? (
        <Folder size={14} className={clsx(styles.entryIcon, styles.dirIcon)} />
      ) : (
        <File size={14} className={styles.entryIcon} />
      )}
      <span className={styles.entryName}>{node.entry.name}</span>
    </div>
  );
}
