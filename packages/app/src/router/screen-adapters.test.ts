import { describe, it, expect } from "vitest";
import {
  toOpenProjectContext,
  toHostSessions,
  toHostSchedules,
  scheduleToRecord,
  detectOsFamily,
} from "./screen-adapters.js";
import type { AgentEntry } from "../store/session-store.js";
import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import type { Schedule } from "../hooks/use-nav-hooks.js";

function makeHost(overrides: Partial<HostRuntimeSnapshot> = {}): HostRuntimeSnapshot {
  return {
    profile: { id: "local-daemon", label: "Pi-Studio", kind: "direct", url: "ws://x", createdAtMs: 0 },
    status: "online",
    serverId: "srv-1",
    features: {},
    reconnectAttempt: 0,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    agentId: "a1",
    status: "idle",
    labels: {},
    capabilities: {} as AgentEntry["capabilities"],
    permissions: {},
    timeline: { rows: [], cursor: undefined } as unknown as AgentEntry["timeline"],
    lastActivity: 1000,
    optimisticMessages: {},
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "s1",
    title: "Nightly build",
    enabled: true,
    prompt: "Run the build",
    target: { type: "agent", agentId: "a1" },
    runs: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("toOpenProjectContext", () => {
  it("returns an empty context when disconnected", () => {
    expect(toOpenProjectContext(undefined)).toEqual({ serverId: undefined, host: undefined });
  });

  it("carries the host's serverId when connected", () => {
    const host = makeHost();
    expect(toOpenProjectContext(host)).toEqual({ serverId: "srv-1", host });
  });
});

describe("toHostSessions", () => {
  it("returns an empty array when there is no active host", () => {
    expect(toHostSessions([], undefined)).toEqual([]);
  });

  it("maps agents into a single HostSessions entry", () => {
    const agents = [makeAgent({ agentId: "a1", title: "Fix bug", cwd: "/tmp/x", lastActivity: 500 })];
    const [host] = toHostSessions(agents, makeHost());
    expect(host).toEqual({
      serverId: "srv-1",
      hostLabel: "Pi-Studio",
      loading: false,
      error: undefined,
      rows: [{ agentId: "a1", title: "Fix bug", cwd: "/tmp/x", lastActivityMs: 500 }],
    });
  });

  it("marks loading while connecting and surfaces the last error", () => {
    const loadingHost = toHostSessions([], makeHost({ status: "connecting" }))[0]!;
    expect(loadingHost.loading).toBe(true);

    const errorHost = toHostSessions([], makeHost({ status: "error", lastError: "boom" }))[0]!;
    expect(errorHost.error).toBe("boom");
  });

  it("falls back to the agentId as title when untitled", () => {
    const host = toHostSessions([makeAgent({ title: undefined })], makeHost())[0]!;
    expect(host.rows[0]!.title).toBe("a1");
  });
});

describe("scheduleToRecord", () => {
  it("maps a cron schedule targeting an existing agent", () => {
    const record = scheduleToRecord(makeSchedule({ cron: "0 0 * * *", timezone: "UTC" }));
    expect(record.cadence).toEqual({ type: "cron", expression: "0 0 * * *", timezone: "UTC" });
    expect(record.target).toEqual({ type: "agent", agentId: "a1" });
    expect(record.status).toBe("active");
  });

  it("maps an interval schedule targeting a new agent", () => {
    const record = scheduleToRecord(
      makeSchedule({
        everyMs: 60_000,
        target: { type: "new_agent", config: { provider: "pi", cwd: "/tmp" } },
      }),
    );
    expect(record.cadence).toEqual({ type: "every", everyMs: 60_000 });
    expect(record.target).toEqual({
      type: "new-agent",
      config: { provider: "pi", cwd: "/tmp", modeId: undefined, model: undefined, thinkingOptionId: undefined, title: "Nightly build" },
    });
  });

  it("marks a paused schedule", () => {
    expect(scheduleToRecord(makeSchedule({ pausedAt: 123 })).status).toBe("paused");
  });

  it("marks a schedule completed once it hits maxRuns", () => {
    const record = scheduleToRecord(
      makeSchedule({ maxRuns: 1, runs: [{ id: "r1", status: "succeeded" }] }),
    );
    expect(record.status).toBe("completed");
  });
});

describe("toHostSchedules", () => {
  it("returns an empty array when there is no active host", () => {
    expect(toHostSchedules([], [], undefined, false)).toEqual([]);
  });

  it("maps schedules + agent directory into a single HostSchedules entry", () => {
    const host = toHostSchedules(
      [makeSchedule()],
      [makeAgent({ agentId: "a1", title: "Fix bug", provider: "mock" })],
      makeHost(),
      false,
    )[0]!;
    expect(host.serverId).toBe("srv-1");
    expect(host.agentDirectoryReady).toBe(true);
    expect(host.agents).toEqual([{ agentId: "a1", title: "Fix bug", provider: "mock" }]);
    expect(host.schedules).toHaveLength(1);
    expect(host.schedules[0]!.id).toBe("s1");
  });

  it("propagates the loading flag", () => {
    const host = toHostSchedules([], [], makeHost(), true)[0]!;
    expect(host.loading).toBe(true);
  });
});

describe("detectOsFamily", () => {
  it("detects macOS", () => {
    expect(detectOsFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
  });

  it("detects Windows", () => {
    expect(detectOsFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  });

  it("falls back to linux", () => {
    expect(detectOsFamily("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});
