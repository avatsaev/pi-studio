/**
 * One row in the session list (POC `renderSessions` per-item markup, POC_TO_APP_PLAN_UI.md §4.2).
 * Presentational: `SessionList.tsx` owns selection, the context menu, and the drag payload.
 */

import type { DragEvent } from "react";
import { MoreVertical } from "lucide-react";
import { clsx } from "clsx";
import { IconButton } from "@pi-studio-ui/components/primitives/IconButton.js";
import { StatusDot } from "@pi-studio-ui/components/primitives/StatusDot.js";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { toDotStatus } from "./status-map.js";
import styles from "./SessionList.module.css";

export interface SessionItemProps {
  session: SessionEntry;
  active: boolean;
  /** False for a row outside the workspace currently in view — see `SessionList`'s
   * `handleDragStart` for why those rows must not be draggable into a pane at all. */
  draggable: boolean;
  onSelect: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onDragStartRow: (e: DragEvent) => void;
}

export function SessionItem({
  session,
  active,
  draggable,
  onSelect,
  onOpenMenu,
  onDragStartRow,
}: SessionItemProps) {
  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      draggable={draggable}
      onDragStart={onDragStartRow}
      onClick={onSelect}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onOpenMenu(ev.clientX, ev.clientY);
      }}
    >
      <div className={styles.title}>
        <StatusDot status={toDotStatus(session.status)} showInactive />
        <span>{session.title}</span>
      </div>
      <div className={styles.meta}>
        {session.cwd || "~"} · {session.agentId ? session.agentId.slice(0, 8) : "new"} ·{" "}
        {session.userMessageCount} msgs
      </div>
      <IconButton
        className={styles.menuBtn}
        hoverBase="var(--pi-color-surfaceSidebar)"
        title="Actions"
        onClick={(ev) => {
          ev.stopPropagation();
          const rect = ev.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom);
        }}
      >
        <MoreVertical size={14} />
      </IconButton>
    </div>
  );
}
