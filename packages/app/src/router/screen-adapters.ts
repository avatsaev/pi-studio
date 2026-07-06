/**
 * Adapters mapping live daemon hooks (session store, nav hooks) into the
 * (Paseo-shaped, multi-host-capable) prop contracts of the real HomeScreen /
 * SessionsScreen / SchedulesScreen / SettingsScreen components.
 *
 * Pi-Studio currently connects to exactly one daemon at a time (see
 * `shell-adapters.ts`); these adapters project that single connection into
 * the one-element `HostSessions[]` / `HostSchedules[]` arrays those screens
 * expect, so the components can be reused as-is.
 *
 * clean-room-scope/features/app-navigation-screens.md
 */

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import type { OpenProjectContext } from "../screens/open-project.js";
import type { HostSessions, HostSchedules, ScheduleRecord, ScheduleCadence, ScheduleTarget } from "../screens/cross-host.js";
import type { AgentEntry } from "../store/session-store.js";
import type { Schedule } from "../hooks/use-nav-hooks.js";
import type { OsFamily } from "../ui/shortcut.js";

const LOCAL_HOST_LABEL = "Pi-Studio";

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------

export function toOpenProjectContext(host: HostRuntimeSnapshot | undefined): OpenProjectContext {
  return { serverId: host?.serverId, host };
}

// ---------------------------------------------------------------------------
// SessionsScreen
// ---------------------------------------------------------------------------

/**
 * Builds the single-element `HostSessions[]` array from the live agent
 * directory. Returns `[]` when there is no active host (nothing to show —
 * matches `aggregateSessions([])` => `{ kind: "empty" }`).
 */
export function toHostSessions(
  agents: readonly AgentEntry[],
  host: HostRuntimeSnapshot | undefined,
): HostSessions[] {
  if (!host?.serverId) return [];
  return [
    {
      serverId: host.serverId,
      hostLabel: host.profile.label || LOCAL_HOST_LABEL,
      loading: host.status === "connecting",
      error: host.status === "error" ? (host.lastError ?? "Connection error") : undefined,
      rows: agents.map((agent) => ({
        agentId: agent.agentId,
        title: agent.title ?? agent.agentId,
        cwd: agent.cwd,
        lastActivityMs: agent.lastActivity,
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// SchedulesScreen
// ---------------------------------------------------------------------------

/** Maps the nav-hooks `Schedule` (daemon RPC shape) to the cross-host screen's `ScheduleRecord`. */
export function scheduleToRecord(schedule: Schedule): ScheduleRecord {
  const cadence: ScheduleCadence = schedule.cron
    ? { type: "cron", expression: schedule.cron, timezone: schedule.timezone }
    : schedule.everyMs !== undefined
      ? { type: "every", everyMs: schedule.everyMs }
      : { type: "once", at: schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : new Date().toISOString() };

  const target: ScheduleTarget =
    schedule.target.type === "agent" && schedule.target.agentId
      ? { type: "agent", agentId: schedule.target.agentId }
      : {
          type: "new-agent",
          config: {
            provider: String(schedule.target.config?.provider ?? "mock"),
            cwd: schedule.target.config?.cwd as string | undefined,
            modeId: schedule.target.config?.modeId as string | undefined,
            model: schedule.target.config?.model as string | undefined,
            thinkingOptionId: schedule.target.config?.thinkingOptionId as string | undefined,
            title: schedule.title,
          },
        };

  const status: ScheduleRecord["status"] = schedule.pausedAt
    ? "paused"
    : schedule.maxRuns !== undefined && schedule.runs.length >= schedule.maxRuns
      ? "completed"
      : "active";

  return {
    id: schedule.id,
    name: schedule.title,
    prompt: schedule.prompt,
    cadence,
    target,
    status,
    createdAt: new Date(schedule.createdAt).toISOString(),
    nextRunAt: schedule.nextRunAt ? new Date(schedule.nextRunAt).toISOString() : undefined,
    expiresAt: schedule.expiresAt ? new Date(schedule.expiresAt).toISOString() : undefined,
    maxRuns: schedule.maxRuns,
    runs: schedule.runs.map((r) => ({ id: r.id, status: r.status })),
  };
}

export function toHostSchedules(
  schedules: readonly Schedule[],
  agents: readonly AgentEntry[],
  host: HostRuntimeSnapshot | undefined,
  loading: boolean,
): HostSchedules[] {
  if (!host?.serverId) return [];
  return [
    {
      serverId: host.serverId,
      hostLabel: host.profile.label || LOCAL_HOST_LABEL,
      loading,
      error: host.status === "error" ? (host.lastError ?? "Connection error") : undefined,
      agentDirectoryReady: true,
      agents: agents.map((a) => ({ agentId: a.agentId, title: a.title, provider: a.provider })),
      schedules: schedules.map(scheduleToRecord),
    },
  ];
}

// ---------------------------------------------------------------------------
// SettingsScreen
// ---------------------------------------------------------------------------

/** Detects the OS family from the browser UA for shortcut-help formatting. */
export function detectOsFamily(userAgent?: string): OsFamily {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return "macos";
  if (/Win/.test(ua)) return "windows";
  return "linux";
}
