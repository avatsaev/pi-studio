/**
 * Collapsible workspace header in the sidebar tree — one per distinct session `cwd`
 * (POC_TO_APP_PLAN_UI.md §4.3 workspace grouping). Clicking anywhere on the header (or its
 * chevron) toggles collapse/expand; opening a session is a separate, explicit action (click a
 * session row). New conversation / Delete workspace live behind the "⋮" button's
 * `WorkspaceContextMenu` — a single consolidated menu instead of two always-visible icon buttons
 * (file-explorer quick-wins-1).
 */

import { ChevronDown, ChevronRight, FolderClosed, MoreVertical } from "lucide-react";
import { clsx } from "clsx";
import styles from "./SessionList.module.css";

export interface WorkspaceGroupHeaderProps {
  label: string;
  cwd: string;
  sessionCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMenu: (x: number, y: number) => void;
}

export function WorkspaceGroupHeader({
  label,
  cwd,
  sessionCount,
  collapsed,
  onToggleCollapsed,
  onOpenMenu,
}: WorkspaceGroupHeaderProps) {
  return (
    <div className={styles.workspaceHeader} onClick={onToggleCollapsed} title={cwd}>
      <button
        type="button"
        className={styles.workspaceChevron}
        aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
        onClick={(ev) => {
          ev.stopPropagation();
          onToggleCollapsed();
        }}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>
      <FolderClosed size={13} className={clsx(styles.workspaceIcon)} />
      <span className={styles.workspaceLabel}>{label}</span>
      <span className={styles.workspaceCount}>{sessionCount}</span>
      <button
        type="button"
        className={styles.workspaceMenuBtn}
        title="Workspace actions"
        onClick={(ev) => {
          ev.stopPropagation();
          const rect = ev.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom);
        }}
      >
        <MoreVertical size={13} />
      </button>
    </div>
  );
}
