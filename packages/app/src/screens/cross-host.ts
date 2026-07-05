// Cross-host Sessions + Schedules screen models.
// app-navigation-screens.md § Sessions, § Schedules; schedules-heartbeats.md

import { routes } from "../runtime/route-grammar.js";

export type CrossHostFilter = "all" | string; // string = serverId

export type SessionRow = {
  serverId: string;
  hostLabel: string;
  agentId: string;
  title: string;
  cwd?: string;
  lastActivityMs: number;
};

export type HostSessions = {
  serverId: string;
  hostLabel: string;
  loading: boolean;
  error?: string;
  rows: readonly Omit<SessionRow, "serverId" | "hostLabel">[];
};

export type SessionsState =
  | { kind: "loading" }
  | { kind: "empty"; showHostFilter: boolean; errors: readonly string[] }
  | { kind: "list"; rows: SessionRow[]; showOriginHost: boolean; showHostFilter: boolean; errors: readonly string[] };

export function aggregateSessions(hosts: readonly HostSessions[], filter: CrossHostFilter = "all"): SessionsState {
  const visibleHosts = filter === "all" ? hosts : hosts.filter((h) => h.serverId === filter);
  const errors = visibleHosts.flatMap((h) => h.error ? [`${h.hostLabel}: ${h.error}`] : []);
  if (visibleHosts.length > 0 && visibleHosts.every((h) => h.loading)) return { kind: "loading" };

  const rows = visibleHosts.flatMap((h) => h.rows.map((row): SessionRow => ({ ...row, serverId: h.serverId, hostLabel: h.hostLabel })));
  rows.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  const showHostFilter = hosts.length > 1;
  if (rows.length === 0) return { kind: "empty", showHostFilter, errors };
  return { kind: "list", rows, showOriginHost: filter === "all" && hosts.length > 1, showHostFilter, errors };
}

export function legacyHostSessionsRedirect(): string {
  return routes.sessions();
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export type ScheduleCadence =
  | { type: "every"; everyMs: number }
  | { type: "cron"; expression: string; timezone?: string }
  | { type: "once"; at: string };

export type ScheduleTarget =
  | { type: "agent"; agentId: string }
  | { type: "new-agent"; config: { provider: string; cwd?: string; modeId?: string; model?: string; thinkingOptionId?: string; title?: string } };

export type ScheduleRun = { id: string; status: "running" | "succeeded" | "failed" };

export type ScheduleRecord = {
  id: string;
  name?: string;
  prompt: string;
  cadence: ScheduleCadence;
  target: ScheduleTarget;
  status: "active" | "paused" | "completed";
  createdAt: string;
  nextRunAt?: string;
  expiresAt?: string;
  maxRuns?: number;
  runs: ScheduleRun[];
};

export type AgentDirectoryEntry = { agentId: string; title?: string; provider?: string };

export type HostSchedules = {
  serverId: string;
  hostLabel: string;
  loading: boolean;
  error?: string;
  agentDirectoryReady: boolean;
  agents: readonly AgentDirectoryEntry[];
  schedules: readonly ScheduleRecord[];
};

export type ScheduleBucket = "active" | "ended";
export type ScheduleTargetState = "ready" | "loading" | "gone";

export type ResolvedScheduleRow = {
  serverId: string;
  hostLabel: string;
  scheduleId: string;
  name: string;
  bucket: ScheduleBucket;
  targetLabel: string;
  targetState: ScheduleTargetState;
  cadence: ScheduleCadence;
  prompt: string;
};

export function scheduleBucket(schedule: ScheduleRecord, nowMs: number): ScheduleBucket {
  if (schedule.status === "completed") return "ended";
  if (schedule.maxRuns !== undefined && schedule.runs.length >= schedule.maxRuns) return "ended";
  if (schedule.expiresAt && Date.parse(schedule.expiresAt) <= nowMs) return "ended";
  return "active";
}

export function resolveScheduleRow(host: HostSchedules, schedule: ScheduleRecord, nowMs: number): ResolvedScheduleRow {
  let targetLabel: string;
  let targetState: ScheduleTargetState = "ready";

  const target = schedule.target;
  if (target.type === "new-agent") {
    targetLabel = target.config.title ?? `New ${target.config.provider} agent`;
  } else {
    const agent = host.agents.find((a) => a.agentId === target.agentId);
    if (agent) {
      targetLabel = agent.title ?? `Agent ${agent.agentId}`;
    } else if (!host.agentDirectoryReady) {
      targetLabel = "Loading target…";
      targetState = "loading";
    } else {
      targetLabel = "Target gone";
      targetState = "gone";
    }
  }

  return {
    serverId: host.serverId,
    hostLabel: host.hostLabel,
    scheduleId: schedule.id,
    name: schedule.name ?? schedule.id,
    bucket: scheduleBucket(schedule, nowMs),
    targetLabel,
    targetState,
    cadence: schedule.cadence,
    prompt: schedule.prompt,
  };
}

export type SchedulesState =
  | { kind: "loading" }
  | { kind: "empty"; showHostFilter: boolean; errors: readonly string[] }
  | { kind: "list"; rows: ResolvedScheduleRow[]; showHostFilter: boolean; errors: readonly string[] };

export function aggregateSchedules(
  hosts: readonly HostSchedules[],
  input: { hostFilter?: CrossHostFilter; statusFilter: ScheduleBucket; nowMs: number },
): SchedulesState {
  const visibleHosts = input.hostFilter && input.hostFilter !== "all" ? hosts.filter((h) => h.serverId === input.hostFilter) : hosts;
  const errors = visibleHosts.flatMap((h) => h.error ? [`${h.hostLabel}: ${h.error}`] : []);
  if (visibleHosts.length > 0 && visibleHosts.every((h) => h.loading)) return { kind: "loading" };

  const rows = visibleHosts
    .flatMap((h) => h.schedules.map((s) => resolveScheduleRow(h, s, input.nowMs)))
    .filter((row) => row.bucket === input.statusFilter)
    .sort((a, b) => b.scheduleId.localeCompare(a.scheduleId));
  const showHostFilter = hosts.length > 1;
  if (rows.length === 0) return { kind: "empty", showHostFilter, errors };
  return { kind: "list", rows, showHostFilter, errors };
}

export type ScheduleFormValues = {
  name?: string;
  cadence: ScheduleCadence;
  target: ScheduleTarget;
  prompt: string;
  maxRuns?: number;
  expiresAt?: string;
};

export function scheduleFormToRequest(values: ScheduleFormValues): ScheduleFormValues {
  return { ...values };
}
