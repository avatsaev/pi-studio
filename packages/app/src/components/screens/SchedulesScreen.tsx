/**
 * SchedulesScreen — /schedules cross-host schedule list.
 * Active/ended filter, host filter, enable/disable/run-now actions.
 * app-navigation-screens.md § Schedules (cross-host)
 */

import { useState, useMemo } from "react";
import { clsx } from "clsx";
import styles from "./SchedulesScreen.module.css";
import { Button, Spinner } from "../primitives/index.js";
import {
  aggregateSchedules,
  type HostSchedules,
  type CrossHostFilter,
  type ScheduleBucket,
  type ResolvedScheduleRow,
} from "../../screens/cross-host.js";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SchedulesScreenProps {
  hosts: readonly HostSchedules[];
  nowMs?: number;
  onNewSchedule: () => void;
  onSelect: (row: ResolvedScheduleRow) => void;
  onRunNow?: (row: ResolvedScheduleRow) => void;
  onToggle?: (row: ResolvedScheduleRow, enable: boolean) => void;
}

export function SchedulesScreen({
  hosts,
  nowMs = Date.now(),
  onNewSchedule,
  onSelect,
}: SchedulesScreenProps) {
  const [statusFilter, setStatusFilter] = useState<ScheduleBucket>("active");
  const [hostFilter, setHostFilter] = useState<CrossHostFilter>("all");

  const state = useMemo(
    () => aggregateSchedules(hosts, { hostFilter, statusFilter, nowMs }),
    [hosts, hostFilter, statusFilter, nowMs],
  );

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>Schedules</span>
        <Button size="sm" onClick={onNewSchedule}>New schedule</Button>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        {/* Status segment */}
        <button
          className={clsx(styles.segmentBtn, statusFilter === "active" && styles.segmentBtnActive)}
          onClick={() => setStatusFilter("active")}
        >
          Active
        </button>
        <button
          className={clsx(styles.segmentBtn, statusFilter === "ended" && styles.segmentBtnActive)}
          onClick={() => setStatusFilter("ended")}
        >
          Ended
        </button>

        {/* Host filter (only when >1 host) */}
        {state.kind !== "loading" && state.showHostFilter && (
          <select
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
            style={{ fontSize: 12, background: "var(--pi-color-surface1)", color: "var(--pi-color-foreground)", border: "1px solid var(--pi-color-border)", borderRadius: 4, padding: "4px 8px", marginLeft: "auto" }}
          >
            <option value="all">All hosts</option>
            {hosts.map((h) => (
              <option key={h.serverId} value={h.serverId}>{h.hostLabel}</option>
            ))}
          </select>
        )}
      </div>

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
          <p className={styles.emptyText}>
            {statusFilter === "active"
              ? "No active schedules. Create one to get started."
              : "No ended schedules."}
          </p>
        </div>
      )}

      {state.kind === "list" && (
        <div className={styles.list}>
          {state.rows.map((row) => (
            <div
              key={`${row.serverId}:${row.scheduleId}`}
              className={styles.row}
              onClick={() => onSelect(row)}
              role="button"
              tabIndex={0}
            >
              <span className={styles.rowName}>{row.name}</span>
              <span className={styles.rowTarget}>{row.targetLabel}</span>
              {state.showHostFilter && <span className={styles.rowHost}>{row.hostLabel}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
