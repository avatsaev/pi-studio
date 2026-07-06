/**
 * SessionsScreen — /sessions (cross-host) and /h/:serverId/sessions.
 * Lists agents/workspaces grouped by host with status + last-activity.
 * app-navigation-screens.md § Sessions (cross-host)
 *
 * Paseo parity: ScreenTitle header, shared ListRow (lead dot + title +
 * muted secondary + trailing time), grouped sections, centered column,
 * quiet empty/error states. docs/design.md §3,§5,§7.
 */

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import styles from "./SessionsScreen.module.css";
import { Spinner } from "../primitives/index.js";
import { ScreenTitle } from "../primitives/ScreenTitle.js";
import { PageColumn } from "./settings-kit.js";
import { ListRow } from "./ListRow.js";
import {
  aggregateSessions,
  type HostSessions,
  type CrossHostFilter,
  type SessionRow,
} from "../../screens/cross-host.js";

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

/** Basename of a cwd, for the muted secondary line. */
function shortPath(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return base || trimmed;
}

// ---------------------------------------------------------------------------
// AgentListItem — reusable row (also used in the subagents track).
// ---------------------------------------------------------------------------

export interface AgentListItemProps {
  title: string;
  hostLabel?: string;
  showOriginHost?: boolean;
  lastActivityMs: number;
  onClick?: () => void;
}

export function AgentListItem({ title, hostLabel, showOriginHost, lastActivityMs, onClick }: AgentListItemProps) {
  return (
    <ListRow
      lead={<span className={styles.dot} />}
      title={title}
      secondary={showOriginHost ? hostLabel : undefined}
      trailing={relativeTime(lastActivityMs)}
      onClick={onClick}
    />
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

export function SessionsScreen({ hosts, initialFilter = "all", onSelectSession }: SessionsScreenProps) {
  const [filter, setFilter] = useState<CrossHostFilter>(initialFilter);
  const state = useMemo(() => aggregateSessions(hosts, filter), [hosts, filter]);

  const showHostFilter = state.kind !== "loading" && state.showHostFilter;

  // Group rows by host when cross-host, else a single flat group.
  const groups = useMemo(() => {
    if (state.kind !== "list") return [];
    if (!state.showOriginHost) return [{ label: undefined as string | undefined, rows: state.rows }];
    const map = new Map<string, SessionRow[]>();
    for (const row of state.rows) {
      const key = row.hostLabel || "Unknown host";
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].map(([label, rows]) => ({ label, rows }));
  }, [state]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <ScreenTitle>Sessions</ScreenTitle>
        {showHostFilter && (
          <select
            className={styles.select}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by host"
          >
            <option value="all">All hosts</option>
            {hosts.map((h) => (
              <option key={h.serverId} value={h.serverId}>{h.hostLabel}</option>
            ))}
          </select>
        )}
      </header>

      <div className={styles.body}>
        <PageColumn>
          {state.kind !== "loading" && state.errors.length > 0 && (
            <div className={styles.errorBanner}>{state.errors.join("; ")}</div>
          )}

          {state.kind === "loading" && (
            <div className={styles.loading}><Spinner /></div>
          )}

          {state.kind === "empty" && (
            <div className={styles.empty}>
              <p className={styles.emptyText}>No sessions yet</p>
              <p className={styles.emptyHint}>Start a new workspace to begin.</p>
            </div>
          )}

          {state.kind === "list" &&
            groups.map((group, i) => (
              <section key={group.label ?? `group-${i}`} className={styles.group}>
                {group.label && <div className={styles.groupLabel}>{group.label}</div>}
                <div className={clsx(styles.list, group.label && styles.listGrouped)}>
                  {group.rows.map((row) => (
                    <ListRow
                      key={`${row.serverId}:${row.agentId}`}
                      lead={<span className={styles.dot} />}
                      title={row.title}
                      secondary={shortPath(row.cwd)}
                      trailing={relativeTime(row.lastActivityMs)}
                      onClick={() => onSelectSession(row)}
                    />
                  ))}
                </div>
              </section>
            ))}
        </PageColumn>
      </div>
    </div>
  );
}
