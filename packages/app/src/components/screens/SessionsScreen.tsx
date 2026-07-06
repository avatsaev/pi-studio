/**
 * SessionsScreen — /sessions (cross-host) and /h/:serverId/sessions.
 * Lists agents/workspaces grouped by host/project with status + attention.
 * app-navigation-screens.md § Sessions (cross-host)
 */

import { useMemo, useState } from "react";
import styles from "./SessionsScreen.module.css";
import { Spinner } from "../primitives/index.js";
import {
  aggregateSessions,
  type HostSessions,
  type CrossHostFilter,
  type SessionRow,
} from "../../screens/cross-host.js";
import { routes } from "../../runtime/route-grammar.js";

// ---------------------------------------------------------------------------
// AgentListItem — reusable row (also used in subagents track, sprint-022)
// ---------------------------------------------------------------------------

export interface AgentListItemProps {
  title: string;
  hostLabel?: string;
  showOriginHost?: boolean;
  lastActivityMs: number;
  onClick?: () => void;
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function AgentListItem({ title, hostLabel, showOriginHost, lastActivityMs, onClick }: AgentListItemProps) {
  return (
    <div className={styles.row} onClick={onClick} role="button" tabIndex={0}>
      <span className={styles.rowTitle}>{title}</span>
      {showOriginHost && hostLabel && <span className={styles.rowHost}>{hostLabel}</span>}
      <span className={styles.rowTime}>{relativeTime(lastActivityMs)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionsScreen
// ---------------------------------------------------------------------------

export interface SessionsScreenProps {
  hosts: readonly HostSessions[];
  /** Pre-set filter (e.g. a specific serverId for legacy per-host route). */
  initialFilter?: CrossHostFilter;
  onSelectSession: (row: SessionRow) => void;
  onBack?: () => void;
}

export function SessionsScreen({ hosts, initialFilter = "all", onSelectSession, onBack }: SessionsScreenProps) {
  const [filter, setFilter] = useState<CrossHostFilter>(initialFilter);
  const state = useMemo(() => aggregateSessions(hosts, filter), [hosts, filter]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>Sessions</div>

      {/* Host filter */}
      {(state.kind !== "loading") && (state.kind === "empty" ? state.showHostFilter : state.showHostFilter) && (
        <div className={styles.filter}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ fontSize: 12, background: "var(--pi-color-surface1)", color: "var(--pi-color-foreground)", border: "1px solid var(--pi-color-border)", borderRadius: 4, padding: "4px 8px" }}
          >
            <option value="all">All hosts</option>
            {hosts.map((h) => (
              <option key={h.serverId} value={h.serverId}>{h.hostLabel}</option>
            ))}
          </select>
        </div>
      )}

      {/* Error banner */}
      {state.kind !== "loading" && state.errors.length > 0 && (
        <div className={styles.errorBanner}>{state.errors.join("; ")}</div>
      )}

      {/* States */}
      {state.kind === "loading" && (
        <div className={styles.loading}><Spinner /></div>
      )}

      {state.kind === "empty" && (
        <div className={styles.empty}>
          <p className={styles.emptyText}>No sessions yet</p>
        </div>
      )}

      {state.kind === "list" && (
        <div className={styles.list}>
          {state.rows.map((row) => (
            <AgentListItem
              key={`${row.serverId}:${row.agentId}`}
              title={row.title}
              hostLabel={row.hostLabel}
              showOriginHost={state.showOriginHost}
              lastActivityMs={row.lastActivityMs}
              onClick={() => onSelectSession(row)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
