/**
 * Collapsible workspace header in the sidebar tree — one per distinct session `cwd`
 * (POC_TO_APP_PLAN_UI.md §4.3 workspace grouping). Clicking anywhere on the header (or its
 * chevron) toggles collapse/expand; opening a session is a separate, explicit action (click a
 * session row, or the "New conversation" button).
 */

import { ChevronDown, ChevronRight, FolderClosed, Plus } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "../../components/primitives/Button.js";
import styles from "./SessionList.module.css";

export interface WorkspaceGroupHeaderProps {
  label: string;
  cwd: string;
  sessionCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNewSession: () => void;
}

export function WorkspaceGroupHeader({
  label,
  cwd,
  sessionCount,
  collapsed,
  onToggleCollapsed,
  onNewSession,
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
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        title="New conversation"
        className={styles.newSessionBtn}
        onClick={(ev) => {
          ev.stopPropagation();
          onNewSession();
        }}
      >
        <Plus size={13} />
      </Button>
    </div>
  );
}
