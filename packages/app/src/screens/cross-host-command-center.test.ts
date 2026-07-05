import { describe, expect, it } from "vitest";

import {
  aggregateSchedules,
  aggregateSessions,
  legacyHostSessionsRedirect,
  resolveScheduleRow,
  scheduleBucket,
  scheduleFormToRequest,
  type HostSchedules,
  type ScheduleRecord,
} from "./cross-host.js";
import {
  activateCommandCenterItem,
  commandCenterItems,
  commandCenterReducer,
  FocusRestoreRegistry,
  STATIC_COMMAND_ACTIONS,
  type CommandCenterAgent,
} from "./command-center.js";

const now = Date.parse("2026-01-01T00:00:00Z");

describe("aggregateSessions", () => {
  it("zero hosts -> empty", () => {
    expect(aggregateSessions([])).toEqual({ kind: "empty", showHostFilter: false, errors: [] });
  });

  it("one loading host -> loading", () => {
    expect(aggregateSessions([{ serverId: "h1", hostLabel: "H1", loading: true, rows: [] }])).toEqual({ kind: "loading" });
  });

  it("many hosts aggregate, sort by last activity, show host filter and origin host", () => {
    const state = aggregateSessions([
      { serverId: "h1", hostLabel: "H1", loading: false, rows: [{ agentId: "a1", title: "Old", lastActivityMs: 1 }] },
      { serverId: "h2", hostLabel: "H2", loading: false, rows: [{ agentId: "a2", title: "New", lastActivityMs: 5 }] },
    ]);
    expect(state.kind).toBe("list");
    if (state.kind === "list") {
      expect(state.rows.map((r) => r.agentId)).toEqual(["a2", "a1"]);
      expect(state.showHostFilter).toBe(true);
      expect(state.showOriginHost).toBe(true);
    }
  });

  it("host filter scopes rows and hides origin column", () => {
    const state = aggregateSessions([
      { serverId: "h1", hostLabel: "H1", loading: false, rows: [{ agentId: "a1", title: "One", lastActivityMs: 1 }] },
      { serverId: "h2", hostLabel: "H2", loading: false, rows: [{ agentId: "a2", title: "Two", lastActivityMs: 2 }] },
    ], "h1");
    expect(state.kind).toBe("list");
    if (state.kind === "list") {
      expect(state.rows.map((r) => r.agentId)).toEqual(["a1"]);
      expect(state.showOriginHost).toBe(false);
    }
  });

  it("legacy /h/[serverId]/sessions redirects to /sessions", () => {
    expect(legacyHostSessionsRedirect()).toBe("/sessions");
  });
});

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s1",
    prompt: "ping",
    cadence: { type: "every", everyMs: 1000 },
    target: { type: "agent", agentId: "a1" },
    status: "active",
    createdAt: "2025-01-01T00:00:00Z",
    runs: [],
    ...overrides,
  };
}

function hostSchedules(overrides: Partial<HostSchedules> = {}): HostSchedules {
  return {
    serverId: "h1",
    hostLabel: "H1",
    loading: false,
    agentDirectoryReady: true,
    agents: [{ agentId: "a1", title: "Agent One" }],
    schedules: [schedule()],
    ...overrides,
  };
}

describe("schedules aggregation", () => {
  it("bucket derives ended for completed, maxRuns, and expiresAt", () => {
    expect(scheduleBucket(schedule({ status: "completed" }), now)).toBe("ended");
    expect(scheduleBucket(schedule({ maxRuns: 1, runs: [{ id: "r", status: "succeeded" }] }), now)).toBe("ended");
    expect(scheduleBucket(schedule({ expiresAt: "2025-01-01T00:00:00Z" }), now)).toBe("ended");
    expect(scheduleBucket(schedule({ status: "paused" }), now)).toBe("active");
  });

  it("resolves agent target when directory ready and agent exists", () => {
    const row = resolveScheduleRow(hostSchedules(), schedule(), now);
    expect(row.targetLabel).toBe("Agent One");
    expect(row.targetState).toBe("ready");
  });

  it("does not mark target gone while host agent directory is still loading", () => {
    const row = resolveScheduleRow(hostSchedules({ agentDirectoryReady: false, agents: [] }), schedule(), now);
    expect(row.targetState).toBe("loading");
    expect(row.targetLabel).toBe("Loading target…");
  });

  it("marks target gone only after host directory is ready", () => {
    const row = resolveScheduleRow(hostSchedules({ agentDirectoryReady: true, agents: [] }), schedule(), now);
    expect(row.targetState).toBe("gone");
  });

  it("new-agent target uses provider/title label", () => {
    const row = resolveScheduleRow(hostSchedules(), schedule({ target: { type: "new-agent", config: { provider: "claude", title: "Nightly" } } }), now);
    expect(row.targetLabel).toBe("Nightly");
  });

  it("aggregates active schedules across hosts and shows host filter for many", () => {
    const state = aggregateSchedules([hostSchedules(), hostSchedules({ serverId: "h2", hostLabel: "H2" })], { statusFilter: "active", nowMs: now });
    expect(state.kind).toBe("list");
    if (state.kind === "list") {
      expect(state.rows).toHaveLength(2);
      expect(state.showHostFilter).toBe(true);
    }
  });

  it("empty schedule state carries errors", () => {
    const state = aggregateSchedules([hostSchedules({ schedules: [], error: "down" })], { statusFilter: "active", nowMs: now });
    expect(state).toEqual({ kind: "empty", showHostFilter: false, errors: ["H1: down"] });
  });

  it("schedule form round-trips cadence/target/prompt/maxRuns/expiresAt", () => {
    const values = {
      name: "Daily",
      cadence: { type: "cron" as const, expression: "0 9 * * *", timezone: "Europe/Paris" },
      target: { type: "new-agent" as const, config: { provider: "claude", cwd: "/repo" } },
      prompt: "Check status",
      maxRuns: 5,
      expiresAt: "2026-12-31T00:00:00Z",
    };
    expect(scheduleFormToRequest(values)).toEqual(values);
  });
});

describe("command center", () => {
  const agents: CommandCenterAgent[] = [
    { serverId: "h1", agentId: "old", title: "Old", cwd: "/repo/old", status: "finished", lastActivityMs: 1 },
    { serverId: "h1", agentId: "running", title: "Runner", cwd: "/repo/run", status: "running", lastActivityMs: 2 },
    { serverId: "h2", agentId: "attention", title: "Needs review", cwd: "/repo/review", status: "waiting", requiresAttention: true, lastActivityMs: 3 },
    { serverId: "h2", agentId: "perm", title: "Permission", cwd: "/repo/perm", status: "waiting", pendingPermissionCount: 1, lastActivityMs: 4 },
  ];

  it("ranks needs-input, attention, running, then recency", () => {
    const items = commandCenterItems({ agents, query: "" }).filter((i) => i.kind === "agent");
    expect(items.map((i) => i.kind === "agent" ? i.agent.agentId : "")).toEqual(["perm", "attention", "running", "old"]);
  });

  it("searches agents by title or cwd", () => {
    const items = commandCenterItems({ agents, query: "review" });
    expect(items.some((i) => i.kind === "agent" && i.agent.agentId === "attention")).toBe(true);
  });

  it("static actions are appended and searchable", () => {
    const items = commandCenterItems({ agents: [], query: "settings" });
    expect(items).toEqual([{ kind: "action", action: STATIC_COMMAND_ACTIONS[2], label: "Settings", route: "/settings", rank: 10000 }]);
  });

  it("keyboard reducer opens, moves highlight, wraps, and closes", () => {
    let state = commandCenterReducer({ open: false, highlightedIndex: 0 }, { type: "OPEN", previousFocusId: "composer" });
    expect(state).toEqual({ open: true, highlightedIndex: 0, previousFocusId: "composer" });
    state = commandCenterReducer(state, { type: "ARROW_UP", itemCount: 3 });
    expect(state.highlightedIndex).toBe(2);
    state = commandCenterReducer(state, { type: "ARROW_DOWN", itemCount: 3 });
    expect(state.highlightedIndex).toBe(0);
    expect(commandCenterReducer(state, { type: "CLOSE" }).open).toBe(false);
  });

  it("activating an agent item navigates to the agent route", () => {
    const item = commandCenterItems({ agents: [agents[0]!], query: "" })[0]!;
    expect(activateCommandCenterItem(item)).toEqual({ route: "/h/h1/agent/old" });
  });

  it("focus restore registry restores previous focus", () => {
    const registry = new FocusRestoreRegistry();
    let restored = false;
    registry.register("composer", () => { restored = true; });
    expect(registry.restore("composer")).toBe(true);
    expect(restored).toBe(true);
    expect(registry.restore("missing")).toBe(false);
  });
});
