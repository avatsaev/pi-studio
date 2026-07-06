/**
 * ScheduleDetailDialog — detail view for a single schedule, rendered as an
 * adaptive sheet/dialog. Shows cadence, status, next/last run, target, run
 * history summary, and pause/resume/run-now/delete actions.
 *
 * Display logic lives in `screens/schedule-detail.ts`. Live mutation wiring is
 * in `router/LivePages.tsx`.
 *
 * clean-room-scope/features/schedules-heartbeats.md
 */

import { AdaptiveSheet } from "../overlays/Dialog.js";
import { Button, StatusBadge } from "../primitives/index.js";
import type { Schedule } from "../../hooks/use-nav-hooks.js";
import {
  cadenceLabel,
  scheduleStatusLabel,
  formatTimestamp,
  runSummary,
  resolveScheduleDetailActions,
} from "../../screens/schedule-detail.js";

export interface ScheduleDetailDialogProps {
  schedule: Schedule | null;
  onClose: () => void;
  onPause: (schedule: Schedule) => void;
  onResume: (schedule: Schedule) => void;
  onRunNow: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0" }}>
      <span style={{ opacity: 0.6, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

export function ScheduleDetailDialog({
  schedule,
  onClose,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: ScheduleDetailDialogProps) {
  if (!schedule) return null;
  const actions = resolveScheduleDetailActions(schedule);
  const status = scheduleStatusLabel(schedule);
  const runs = runSummary(schedule.runs ?? []);

  return (
    <AdaptiveSheet
      visible={!!schedule}
      onClose={onClose}
      title={schedule.title || "Schedule"}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {actions.canPause && (
            <Button size="sm" variant="default" onClick={() => onPause(schedule)}>
              Pause
            </Button>
          )}
          {actions.canResume && (
            <Button size="sm" variant="default" onClick={() => onResume(schedule)}>
              Resume
            </Button>
          )}
          {actions.canRunNow && (
            <Button size="sm" variant="default" onClick={() => onRunNow(schedule)}>
              Run now
            </Button>
          )}
          {actions.canDelete && (
            <Button size="sm" variant="ghost" onClick={() => onDelete(schedule)}>
              Delete
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <StatusBadge label={status} variant={status === "Active" ? "success" : "muted"} />
        </div>
        <Row label="Cadence" value={cadenceLabel(schedule)} />
        <Row label="Next run" value={formatTimestamp(schedule.nextRunAt)} />
        <Row label="Last run" value={formatTimestamp(schedule.lastRunAt)} />
        <Row
          label="Runs"
          value={`${runs.total} total · ${runs.succeeded} ok · ${runs.failed} failed${runs.running ? ` · ${runs.running} running` : ""}`}
        />
        <Row label="Target" value={schedule.target?.type === "agent" ? `Agent ${schedule.target.agentId ?? ""}` : "New agent"} />
        <div style={{ marginTop: 12 }}>
          <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 4 }}>Prompt</div>
          <pre
            style={{
              margin: 0,
              padding: 8,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              background: "var(--pi-color-surfaceSunken, rgba(0,0,0,0.2))",
              borderRadius: 6,
            }}
          >
            {schedule.prompt}
          </pre>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
