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
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { IconButton } from "@pi-studio-ui/components/primitives/IconButton.js";
import { StatusDot } from "@pi-studio-ui/components/primitives/StatusDot.js";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { useAgentUiPending } from "@pi-studio-ui/features/agent-ui/agent-ui-store.js";
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
      className={clsx(
        styles.item,
        active && styles.active,
        // A selected row always reads as selected first — the failed tint only applies unselected.
        !active && view.state === "failed" && styles.itemFailed,
      )}
      draggable={draggable}
      onDragStart={onDragStartRow}
      onClick={onSelect}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onOpenMenu(ev.clientX, ev.clientY);
      }}
    >
      {/* The needs-input accent bar does not yield to selection (§ 08: "the accent bar still
          shows") — unlike `.itemFailed`'s wash, which does. */}
      {(active || view.state === "needsInput") && (
        <span
          className={clsx(
            styles.activeBar,
            view.state === "needsInput" && styles.activeBarNeedsInput,
          )}
          aria-hidden
        />
      )}
      <div className={styles.title}>
        <span className={clsx(styles.titleLabel, view.titleItalic && styles.titleItalic)}>
          {session.title}
        </span>
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
          <Icon icon={MoreVertical} size="sm" />
        </IconButton>
      </div>
      <div className={clsx(styles.meta, view.state === "empty" && styles.metaEmpty)}>
        {view.dot && (
          <StatusDot {...view.dot} className={styles.metaDot} pulse={view.state === "needsInput"} />
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
  );
}
