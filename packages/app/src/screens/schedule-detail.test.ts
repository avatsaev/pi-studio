import { describe, it, expect } from "vitest";
import {
  cadenceLabel,
  cadenceKind,
  formatDuration,
  scheduleStatusLabel,
  formatTimestamp,
  runSummary,
  resolveScheduleDetailActions,
} from "./schedule-detail.js";
import type { Schedule } from "../hooks/use-nav-hooks.js";

function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: "s1",
    title: "Nightly",
    enabled: true,
    prompt: "run",
    target: { type: "new_agent" },
    runs: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("cadence", () => {
  it("labels cron with optional timezone", () => {
    expect(cadenceLabel({ cron: "0 3 * * *", timezone: "UTC" })).toBe("0 3 * * * (UTC)");
    expect(cadenceLabel({ cron: "0 3 * * *" })).toBe("0 3 * * *");
  });
  it("labels intervals with a duration", () => {
    expect(cadenceLabel({ everyMs: 30_000 })).toBe("Every 30s");
    expect(cadenceLabel({ everyMs: 3_600_000 })).toBe("Every 1h");
  });
  it("classifies cadence kind", () => {
    expect(cadenceKind({ cron: "0 3 * * *" })).toBe("cron");
    expect(cadenceKind({ everyMs: 1000 })).toBe("interval");
    expect(cadenceKind({})).toBe("once");
  });
});

describe("formatDuration", () => {
  it("scales units", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(7_200_000)).toBe("2h");
    expect(formatDuration(172_800_000)).toBe("2d");
  });
});

describe("scheduleStatusLabel", () => {
  it("prefers paused, then enabled/disabled", () => {
    expect(scheduleStatusLabel({ enabled: true, pausedAt: 123 })).toBe("Paused");
    expect(scheduleStatusLabel({ enabled: true })).toBe("Active");
    expect(scheduleStatusLabel({ enabled: false })).toBe("Disabled");
  });
});

describe("formatTimestamp", () => {
  it("renders a placeholder when absent", () => {
    expect(formatTimestamp(undefined)).toBe("—");
  });
  it("renders iso + relative delta", () => {
    const now = 1_000_000;
    expect(formatTimestamp(now + 60_000, now)).toContain("from now");
    expect(formatTimestamp(now - 60_000, now)).toContain("ago");
  });
});

describe("runSummary", () => {
  it("counts by status", () => {
    expect(
      runSummary([
        { id: "1", status: "succeeded" },
        { id: "2", status: "failed" },
        { id: "3", status: "succeeded" },
        { id: "4", status: "running" },
      ]),
    ).toEqual({ total: 4, succeeded: 2, failed: 1, running: 1 });
  });
});

describe("resolveScheduleDetailActions", () => {
  it("active schedule can be paused", () => {
    expect(resolveScheduleDetailActions({ enabled: true })).toMatchObject({ canPause: true, canResume: false });
  });
  it("paused/disabled schedule can be resumed", () => {
    expect(resolveScheduleDetailActions({ enabled: true, pausedAt: 5 })).toMatchObject({ canPause: false, canResume: true });
    expect(resolveScheduleDetailActions({ enabled: false })).toMatchObject({ canPause: false, canResume: true });
  });
  it("always allows run-now and delete", () => {
    const a = resolveScheduleDetailActions(makeSchedule());
    expect(a.canRunNow).toBe(true);
    expect(a.canDelete).toBe(true);
  });
});
