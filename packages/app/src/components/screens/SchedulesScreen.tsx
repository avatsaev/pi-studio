/**
 * SchedulesScreen — /schedules cross-host schedule list.
 * Active/ended filter, host filter, select-to-open.
 * app-navigation-screens.md § Schedules (cross-host)
 *
 * Paseo parity: ScreenTitle header with a single accent CTA, segmented
 * filter, shared ListRow with status dot + muted target, centered column,
 * quiet empty states. docs/design.md §3,§4,§7.
 */

import { useState, useMemo } from "react";
import { clsx } from "clsx";
import styles from "./SchedulesScreen.module.css";
import { Button, Spinner } from "../primitives/index.js";
import { ScreenTitle } from "../primitives/ScreenTitle.js";
import { PageColumn } from "./settings-kit.js";
import { ListRow } from "./ListRow.js";
import {
  aggregateSchedules,
  type HostSchedules,
  type CrossHostFilter,
  type ScheduleBucket,
  type ResolvedScheduleRow,
} from "../../screens/cross-host.js";

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
      <header className={styles.header}>
        <ScreenTitle>Schedules</ScreenTitle>
        <Button variant="default" size="sm" onClick={onNewSchedule}>New schedule</Button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.segment} role="tablist" aria-label="Schedule status">
          <button
            role="tab"
            aria-selected={statusFilter === "active"}
            className={clsx(styles.segmentBtn, statusFilter === "active" && styles.segmentBtnActive)}
            onClick={() => setStatusFilter("active")}
          >
            Active
          </button>
          <button
            role="tab"
            aria-selected={statusFilter === "ended"}
            className={clsx(styles.segmentBtn, statusFilter === "ended" && styles.segmentBtnActive)}
            onClick={() => setStatusFilter("ended")}
          >
            Ended
          </button>
        </div>

        {state.kind !== "loading" && state.showHostFilter && (
          <select
            className={styles.select}
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
            aria-label="Filter by host"
          >
            <option value="all">All hosts</option>
            {hosts.map((h) => (
              <option key={h.serverId} value={h.serverId}>{h.hostLabel}</option>
            ))}
          </select>
        )}
      </div>

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
              <p className={styles.emptyText}>
                {statusFilter === "active" ? "No active schedules" : "No ended schedules"}
              </p>
              {statusFilter === "active" && (
                <p className={styles.emptyHint}>Create one to run agents on a cadence.</p>
              )}
            </div>
          )}

          {state.kind === "list" && (
            <div className={styles.list}>
              {state.rows.map((row) => (
                <ListRow
                  key={`${row.serverId}:${row.scheduleId}`}
                  lead={
                    <span
                      className={clsx(styles.dot, row.bucket === "active" ? styles.dotActive : styles.dotMuted)}
                    />
                  }
                  title={row.name}
                  secondary={row.targetLabel}
                  trailing={state.showHostFilter ? row.hostLabel : undefined}
                  onClick={() => onSelect(row)}
                />
              ))}
            </div>
          )}
        </PageColumn>
      </div>
    </div>
  );
}
