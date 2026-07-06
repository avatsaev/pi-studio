/**
 * schedule-detail — pure view-model logic for the Schedule detail view.
 *
 * Derives a display model (cadence, status, next/last run, run history summary)
 * and the available actions from a `Schedule` record, so the dialog component
 * stays presentational and the logic is unit-testable.
 *
 * clean-room-scope/features/schedules-heartbeats.md
 * clean-room-scope/sprints/sprint-030-integration-gap-closure/task-004
 */

import type { Schedule, ScheduleRun } from "../hooks/use-nav-hooks.js";

/** Human-readable cadence: cron expression or interval. */
export function cadenceLabel(schedule: Pick<Schedule, "cron" | "everyMs" | "timezone">): string {
  if (schedule.cron) {
    return schedule.timezone ? `${schedule.cron} (${schedule.timezone})` : schedule.cron;
  }
  if (typeof schedule.everyMs === "number" && schedule.everyMs > 0) {
    return `Every ${formatDuration(schedule.everyMs)}`;
  }
  return "One-off";
}

/** Whether the schedule is running on a cron expression vs a fixed interval. */
export function cadenceKind(schedule: Pick<Schedule, "cron" | "everyMs">): "cron" | "interval" | "once" {
  if (schedule.cron) return "cron";
  if (typeof schedule.everyMs === "number" && schedule.everyMs > 0) return "interval";
  return "once";
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Status label: paused takes precedence over enabled/disabled. */
export function scheduleStatusLabel(schedule: Pick<Schedule, "enabled" | "pausedAt">): string {
  if (schedule.pausedAt) return "Paused";
  return schedule.enabled ? "Active" : "Disabled";
}

/** Format an epoch-ms timestamp, or a placeholder when absent. */
export function formatTimestamp(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "—";
  const iso = new Date(ms).toISOString();
  const deltaLabel = relativeDelta(ms - now);
  return `${iso} (${deltaLabel})`;
}

function relativeDelta(deltaMs: number): string {
  const abs = Math.abs(deltaMs);
  const suffix = deltaMs >= 0 ? "from now" : "ago";
  return `${formatDuration(abs)} ${suffix}`;
}

export interface RunSummary {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
}

export function runSummary(runs: readonly ScheduleRun[]): RunSummary {
  const summary: RunSummary = { total: runs.length, succeeded: 0, failed: 0, running: 0 };
  for (const r of runs) {
    if (r.status === "succeeded") summary.succeeded++;
    else if (r.status === "failed") summary.failed++;
    else if (r.status === "running") summary.running++;
  }
  return summary;
}

export interface ScheduleDetailActions {
  canPause: boolean;
  canResume: boolean;
  canRunNow: boolean;
  canDelete: boolean;
}

/**
 * Available actions for a schedule. An active, non-paused schedule can be
 * paused; a disabled or paused one can be resumed. Run-now and delete are
 * always available.
 */
export function resolveScheduleDetailActions(schedule: Pick<Schedule, "enabled" | "pausedAt">): ScheduleDetailActions {
  const paused = !!schedule.pausedAt || !schedule.enabled;
  return {
    canPause: !paused,
    canResume: paused,
    canRunNow: true,
    canDelete: true,
  };
}
