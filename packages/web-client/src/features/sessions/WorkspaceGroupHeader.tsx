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
import type { WorkspaceAttentionInfo } from "./session-presentation.js";
import styles from "./SessionList.module.css";

export interface WorkspaceGroupHeaderProps {
  label: string;
  cwd: string;
  sessionCount: number;
  collapsed: boolean;
  /** Precomputed attention info (`workspaceAttentionDot`), already gated to collapsed-only by the
   * caller. Presentational: builds the § 08 accessible name from its own `label` prop plus the
   * info's reason/count, and opts the dot into the pulse modifier only for the "question" reason
   * (sprint-069/task-003). */
  attentionDot: WorkspaceAttentionInfo | null;
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
      {attentionDot && (
        <StatusDot
          {...attentionDot.dot}
          pulse={attentionDot.reason === "question"}
          aria-label={
            attentionDot.reason === "question"
              ? `${label} — ${attentionDot.pendingSessionCount} session${
                  attentionDot.pendingSessionCount === 1 ? "" : "s"
                } needs input`
              : `${label} — turn failed`
          }
        />
      )}
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
