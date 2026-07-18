/**
 * One row in the session list (POC `renderSessions` per-item markup, POC_TO_APP_PLAN_UI.md §4.2).
 */

import { MoreVertical } from "lucide-react";
import { clsx } from "clsx";
import { StatusDot } from "@pi-studio-ui/components/primitives/StatusDot.js";
import type { SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { toDotStatus } from "./status-map.js";
import styles from "./SessionList.module.css";

export interface SessionItemProps {
  session: SessionEntry;
  active: boolean;
  onSelect: () => void;
  onOpenMenu: (x: number, y: number) => void;
}

export function SessionItem({ session, active, onSelect, onOpenMenu }: SessionItemProps) {
  return (
    <div
      className={clsx(styles.item, active && styles.active)}
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
      <button
        type="button"
        className={styles.menuBtn}
        title="Actions"
        onClick={(ev) => {
          ev.stopPropagation();
          const rect = ev.currentTarget.getBoundingClientRect();
          onOpenMenu(rect.left, rect.bottom);
        }}
      >
        <MoreVertical size={14} />
      </button>
    </div>
  );
}
