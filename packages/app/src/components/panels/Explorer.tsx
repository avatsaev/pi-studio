/**
 * Explorer — file tree sidebar (Files tab).
 * feature-panels-ui.md § file explorer
 */

import { useCallback, useMemo, type ComponentType } from "react";
import {
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileCog,
  Folder,
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";
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
        <span className={styles.toolbarTitle}>Files</span>
        <span className={styles.toolbarActions}>
          <button className={styles.toolbarBtn} onClick={onCycleSortMode} aria-label={`Sort: ${state.sortMode} (click to cycle)`} title={`Sort: ${state.sortMode}`}>
            <ArrowUpDown size={12} />
          </button>
          <button className={styles.toolbarBtn} onClick={onRefresh} aria-label="Refresh" title="Refresh">
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
        (() => {
          const Icon = fileIconFor(node.entry.name);
          return <Icon size={14} className={styles.entryIcon} />;
        })()
      )}
      <span className={styles.entryName}>{node.entry.name}</span>
    </div>
  );
}

// ─── File-type icons ──────────────────────────────────────────────────────────

type IconComponent = ComponentType<{ size?: number; className?: string }>;

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "rb", "php",
  "c", "h", "cpp", "hpp", "cs", "swift", "kt", "sh", "bash", "zsh", "css", "scss",
  "html", "vue", "svelte", "sql",
]);
const DATA_EXT = new Set(["json", "yaml", "yml", "toml", "xml", "lock", "env"]);
const DOC_EXT = new Set(["md", "mdx", "txt", "rst", "log"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);
const CONFIG_NAMES = new Set([
  ".gitignore", ".npmrc", ".editorconfig", "dockerfile", "makefile", ".env",
]);

/** Pick a lucide icon for a file by extension / well-known name (Paseo-style). */
export function fileIconFor(name: string): IconComponent {
  const lower = name.toLowerCase();
  if (CONFIG_NAMES.has(lower)) return FileCog;
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  if (IMAGE_EXT.has(ext)) return FileImage;
  if (DATA_EXT.has(ext)) return FileJson;
  if (CODE_EXT.has(ext)) return FileCode;
  if (DOC_EXT.has(ext)) return FileText;
  return File;
}
