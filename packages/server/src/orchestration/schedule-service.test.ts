import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nextCronTime } from "./cron.js";
import { ScheduleService, type ScheduleExecutor } from "./schedule-service.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-sched-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function recordingExecutor(): {
  executor: ScheduleExecutor;
  created: Array<Record<string, unknown>>;
  prompted: Array<{ agentId: string; prompt: string }>;
} {
  const created: Array<Record<string, unknown>> = [];
  const prompted: Array<{ agentId: string; prompt: string }> = [];
  const executor: ScheduleExecutor = {
    createAndPrompt: async (config) => {
      created.push(config);
      return { agentId: `agent-${created.length}`, output: "ok" };
    },
    promptExisting: async (agentId, prompt) => {
      prompted.push({ agentId, prompt });
      return { output: "pong" };
    },
  };
  return { executor, created, prompted };
}

describe("nextCronTime (timezone)", () => {
  it("fires on local wall-clock time for an IANA timezone (DST-aware)", () => {
    // 09:00 daily in New York. A summer instant (EDT = UTC-4) → next 09:00 EDT = 13:00 UTC.
    const after = new Date("2024-07-01T20:00:00Z");
    const next = nextCronTime("0 9 * * *", after, "America/New_York");
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe("2024-07-02T13:00:00.000Z");

    // A winter instant (EST = UTC-5) → next 09:00 EST = 14:00 UTC.
    const winter = new Date("2024-01-01T20:00:00Z");
    const nextWinter = nextCronTime("0 9 * * *", winter, "America/New_York");
    expect(nextWinter!.toISOString()).toBe("2024-01-02T14:00:00.000Z");
  });

  it("defaults to UTC with no timezone", () => {
    const next = nextCronTime("30 6 * * *", new Date("2024-03-10T00:00:00Z"));
    expect(next!.toISOString()).toBe("2024-03-10T06:30:00.000Z");
  });
});

describe("ScheduleService", () => {
  it("an `every` schedule fires on the interval and records runs", async () => {
    let clock = new Date("2024-01-01T00:00:00Z");
    const { executor, created } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });

    const schedule = await svc.create({
      prompt: "tick",
      cadence: { type: "every", everyMs: 60_000 },
      target: { type: "new-agent", config: { provider: "mock", cwd: "/w" } },
    });
    expect(schedule.nextRunAt).toBe("2024-01-01T00:01:00.000Z");

    // Not yet due.
    await svc.tick(new Date("2024-01-01T00:00:30Z"));
    expect(created).toHaveLength(0);

    // Due → fires once, recomputes nextRunAt.
    clock = new Date("2024-01-01T00:01:05Z");
    await svc.tick(clock);
    const after = await svc.inspect(schedule.id);
    expect(created).toHaveLength(1);
    expect(after!.runs).toHaveLength(1);
    expect(after!.runs[0]!.status).toBe("succeeded");
    expect(after!.lastRunAt).toBe("2024-01-01T00:01:00.000Z");
    expect(after!.nextRunAt).toBe("2024-01-01T00:02:00.000Z");
  });

  it("`agent` target prompts an existing agent (heartbeat)", async () => {
    let clock = new Date("2024-01-01T00:00:00Z");
    const { executor, prompted } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });
    const schedule = await svc.create({
      prompt: "status?",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "agent", agentId: "agent-X" },
    });
    clock = new Date("2024-01-01T00:00:02Z");
    await svc.tick(clock);
    expect(prompted).toEqual([{ agentId: "agent-X", prompt: "status?" }]);
  });

  it("pause stops runs; resume recomputes nextRunAt", async () => {
    let clock = new Date("2024-01-01T00:00:00Z");
    const { executor, created } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });
    const schedule = await svc.create({
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "new-agent", config: { provider: "mock", cwd: "/w" } },
    });

    await svc.pause(schedule.id);
    expect((await svc.inspect(schedule.id))!.status).toBe("paused");
    clock = new Date("2024-01-01T00:00:05Z");
    await svc.tick(clock); // paused → skipped
    expect(created).toHaveLength(0);

    await svc.resume(schedule.id);
    const resumed = await svc.inspect(schedule.id);
    expect(resumed!.status).toBe("active");
    expect(resumed!.nextRunAt).toBe("2024-01-01T00:00:06.000Z");
  });

  it("reaching maxRuns marks the schedule completed", async () => {
    let clock = new Date("2024-01-01T00:00:00Z");
    const { executor } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });
    const schedule = await svc.create({
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "new-agent", config: { provider: "mock", cwd: "/w" } },
      maxRuns: 2,
    });
    for (let i = 1; i <= 3; i++) {
      clock = new Date(`2024-01-01T00:00:0${i}Z`);
      await svc.tick(clock);
    }
    const final = await svc.inspect(schedule.id);
    expect(final!.runs).toHaveLength(2); // capped
    expect(final!.status).toBe("completed");
    expect(final!.nextRunAt).toBeUndefined();
  });

  it("past expiresAt auto-completes", async () => {
    let clock = new Date("2024-01-01T00:00:00Z");
    const { executor } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });
    const schedule = await svc.create({
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "new-agent", config: { provider: "mock", cwd: "/w" } },
      expiresAt: "2024-01-01T00:00:05Z",
    });
    clock = new Date("2024-01-01T00:00:10Z");
    await svc.tick(clock);
    expect((await svc.inspect(schedule.id))!.status).toBe("completed");
  });

  it("run-once executes immediately without altering cadence", async () => {
    const clock = new Date("2024-01-01T00:00:00Z");
    const { executor, created } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });
    const schedule = await svc.create({
      prompt: "p",
      cadence: { type: "every", everyMs: 60_000 },
      target: { type: "new-agent", config: { provider: "mock", cwd: "/w" } },
    });
    const nextBefore = schedule.nextRunAt;
    const run = await svc.runOnce(schedule.id);
    expect(run!.status).toBe("succeeded");
    expect(created).toHaveLength(1);
    expect((await svc.inspect(schedule.id))!.nextRunAt).toBe(nextBefore); // unchanged
  });

  it("rejects an invalid cron expression", async () => {
    const { executor } = recordingExecutor();
    const svc = new ScheduleService({ home, executor });
    await expect(
      svc.create({
        prompt: "p",
        cadence: { type: "cron", expression: "not a cron" },
        target: { type: "agent", agentId: "a" },
      }),
    ).rejects.toThrow();
  });

  it("persists across reload", async () => {
    const clock = new Date("2024-01-01T00:00:00Z");
    const { executor } = recordingExecutor();
    const svc = new ScheduleService({ home, executor, now: () => clock });
    const schedule = await svc.create({
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "agent", agentId: "a" },
    });
    const reloaded = new ScheduleService({ home, executor, now: () => clock });
    expect((await reloaded.inspect(schedule.id))?.prompt).toBe("p");
  });
});
