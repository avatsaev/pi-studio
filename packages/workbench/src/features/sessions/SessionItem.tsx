/**
 * One row in the session list (POC `renderSessions` per-item markup, POC_TO_APP_PLAN_UI.md §4.2).
 * Presentational: `SessionList.tsx` owns selection, the context menu, and the drag payload; row
 * state (title/meta/reason/dot/italic) comes entirely from `sidebarSessionView` (task-001), so
 * this component never reaches into `session.status`/`.timeline` itself (design spec § 03). The
 * one exception is the needs-input source itself (sprint-068's `useAgentUiPending`) — a store read
 * `sidebarSessionView` deliberately does not perform, staying pure (sprint-069/task-001).
 */

import type { DragEvent } from "react";
import { MoreVertical } from "lucide-react";
import { clsx } from "clsx";
import { Icon, IconButton, StatusDot } from "@av-pi-studio/ui-library";
import type { SessionEntry } from "../../stores/session-store.js";
import { useAgentUiPending } from "../agent-ui/agent-ui-store.js";
import { sidebarSessionView } from "./session-presentation.js";
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
  const pending = useAgentUiPending(session.agentId ?? "");
  const view = sidebarSessionView(session, pending.length > 0);

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      data-session-row={session.id}
      // Not a tab stop — focusable only so closing the rename dialog can return focus here.
      tabIndex={-1}
      draggable={draggable}
      onDragStart={onDragStartRow}
      onClick={onSelect}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onOpenMenu(ev.clientX, ev.clientY);
      }}
    >
      <div className={styles.body}>
        <span className={clsx(styles.titleLabel, view.titleItalic && styles.titleItalic)}>
          {session.title}
        </span>
        <div className={clsx(styles.meta, view.state === "empty" && styles.metaEmpty)}>
          {view.dot && (
            <StatusDot
              {...view.dot}
              className={styles.metaDot}
              pulse={view.state === "needsInput"}
            />
          )}
          <span className={styles.metaLabel}>
            <span
              className={
                view.state === "failed"
                  ? styles.metaFailed
                  : view.state === "needsInput"
                    ? styles.metaNeedsInput
                    : undefined
              }
            >
              {view.meta}
            </span>
            {view.reason && <> · {view.reason}</>}
          </span>
        </div>
      </div>
      <IconButton
        className={styles.menuBtn}
        hoverBase="var(--pi-color-surface2)"
        title="Actions"
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
