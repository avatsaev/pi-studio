/**
 * Collapsible workspace header in the sidebar tree — one per distinct session `cwd`
 * (POC_TO_APP_PLAN_UI.md §4.3 workspace grouping). Rendered as a full-bleed band (design spec
 * § 03): `surface2` fill, no card frame, same look expanded or collapsed — expansion is expressed
 * only by the chevron rotation and the presence of session rows below it. Clicking anywhere on
 * the header (or its chevron) toggles collapse/expand; opening a session is a separate, explicit
 * action (click a session row). New session / Delete workspace live behind the "⋮" button's
 * `WorkspaceContextMenu` — a single consolidated menu instead of two always-visible icon buttons
 * (file-explorer quick-wins-1).
 */

import { ChevronRight, MoreVertical } from "lucide-react";
import { Avatar } from "@pi-studio-ui/components/primitives/Avatar.js";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { IconButton } from "@pi-studio-ui/components/primitives/IconButton.js";
import { StatusDot } from "@pi-studio-ui/components/primitives/StatusDot.js";
import type { StatusDotInput } from "@pi-studio-ui/ui/status-dot.js";
import styles from "./SessionList.module.css";

export interface WorkspaceGroupHeaderProps {
  label: string;
  cwd: string;
  sessionCount: number;
  collapsed: boolean;
  /** Precomputed attention dot (`workspaceAttentionDot`), already gated to collapsed-only by the
   * caller — this component renders it whenever it is non-null and stays presentational. */
  attentionDot: StatusDotInput | null;
  onToggleCollapsed: () => void;
  onOpenMenu: (x: number, y: number) => void;
}

export function WorkspaceGroupHeader({
  label,
  cwd,
  sessionCount,
  collapsed,
  attentionDot,
  onToggleCollapsed,
  onOpenMenu,
}: WorkspaceGroupHeaderProps) {
  return (
    <div className={styles.workspaceHeader} onClick={onToggleCollapsed} title={cwd}>
      <IconButton
        className={styles.workspaceChevron}
        aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
        onClick={(ev) => {
          ev.stopPropagation();
          onToggleCollapsed();
        }}
      >
        <Icon
          icon={ChevronRight}
          size="xs"
          className={!collapsed ? styles.chevronGlyphExpanded : undefined}
        />
      </IconButton>
      <Avatar projectKey={label} size={20} />
      <span className={styles.workspaceLabel}>{label}</span>
      {attentionDot && <StatusDot {...attentionDot} />}
      <span className={styles.workspaceCount}>{sessionCount}</span>
      <IconButton
        className={styles.workspaceMenuBtn}
        hoverBase="var(--pi-color-surface2)"
        title="Workspace actions"
        onClick={(ev) => {
          ev.stopPropagation();
          const rect = ev.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom);
        }}
      >
        <Icon icon={MoreVertical} size="sm" />
      </IconButton>
    </div>
  );
}
