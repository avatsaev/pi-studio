import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLoopStore } from "../persistence/entity-stores.js";
import { LoopService, type LoopExecutor } from "./loop-service.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-loop-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Configurable fake executor. `checkExit`/`verdict` may vary per call via a queue. */
function makeExecutor(
  opts: {
    checkExits?: number[]; // exit codes per runShellCheck call
    verdicts?: boolean[]; // verifier pass per call
  } = {},
): {
  executor: LoopExecutor;
  workerCalls: number;
  archived: string[];
  state: { workerCalls: number };
} {
  const archived: string[] = [];
  const state = { workerCalls: 0 };
  let checkIdx = 0;
  let verdictIdx = 0;
  const executor: LoopExecutor = {
    runWorker: async () => {
      state.workerCalls += 1;
      return { agentId: `worker-${state.workerCalls}`, outcome: "completed", output: "did work" };
    },
    runShellCheck: async (command) => {
      const exitCode = opts.checkExits?.[checkIdx++] ?? 0;
      return { exitCode, stdout: `ran ${command}`, stderr: "" };
    },
    runVerifier: async () => {
      const passed = opts.verdicts?.[verdictIdx++] ?? true;
      return { passed, reason: passed ? "looks good" : "not yet", agentId: "verifier-1" };
    },
    archiveAgent: async (id) => {
      archived.push(id);
    },
  };
  return { executor, workerCalls: 0, archived, state };
}

const noSleep = async (): Promise<void> => {};

describe("LoopService.run", () => {
  it("creates a worker per iteration and records its outcome; first success ends succeeded", async () => {
    const { executor, state } = makeExecutor({ checkExits: [0], verdicts: [true] });
    const svc = new LoopService({ home, executor, sleep: noSleep });
    const rec = await svc.run({
      prompt: "do it",
      cwd: "/w",
      provider: "mock",
      verifyChecks: ["npm test"],
      verifyPrompt: "is it done?",
      maxIterations: 5,
    });
    expect(rec.status).toBe("succeeded");
    expect(state.workerCalls).toBe(1);
    const iters = rec.iterations as Array<{
      status: string;
      workerAgentId?: string;
      verifyChecks: unknown[];
    }>;
    expect(iters).toHaveLength(1);
    expect(iters[0]!.status).toBe("succeeded");
    expect(iters[0]!.workerAgentId).toBe("worker-1");
    expect(iters[0]!.verifyChecks).toHaveLength(1);
  });

  it("requires ALL verifyChecks and the verifyPrompt to pass", async () => {
    // iter1: check fails → iteration fails; iter2: check passes + verdict passes → success.
    const { executor, state } = makeExecutor({ checkExits: [1, 0], verdicts: [true] });
    const svc = new LoopService({ home, executor, sleep: noSleep });
    const rec = await svc.run({
      prompt: "p",
      cwd: "/w",
      provider: "mock",
      verifyChecks: ["lint"],
      verifyPrompt: "done?",
      maxIterations: 5,
    });
    expect(rec.status).toBe("succeeded");
    expect(state.workerCalls).toBe(2);
    const iters = rec.iterations as Array<{ status: string }>;
    expect(iters[0]!.status).toBe("failed");
    expect(iters[1]!.status).toBe("succeeded");
  });

  it("exceeding maxIterations ends failed", async () => {
    const { executor, state } = makeExecutor({ verdicts: [false, false] });
    const svc = new LoopService({ home, executor, sleep: noSleep });
    const rec = await svc.run({
      prompt: "p",
      cwd: "/w",
      provider: "mock",
      verifyPrompt: "done?",
      maxIterations: 2,
    });
    expect(rec.status).toBe("failed");
    expect(state.workerCalls).toBe(2);
  });

  it("archive:true archives the worker each iteration", async () => {
    const { executor, archived } = makeExecutor({ verdicts: [false, true] });
    const svc = new LoopService({ home, executor, sleep: noSleep });
    await svc.run({
      prompt: "p",
      cwd: "/w",
      provider: "mock",
      verifyPrompt: "done?",
      archive: true,
      maxIterations: 5,
    });
    expect(archived).toEqual(["worker-1", "worker-2"]);
  });

  it("stop yields stopped after the current step", async () => {
    // Build a service whose worker requests stop during iteration 1.
    const archived: string[] = [];
    let svc!: LoopService;
    let loopId = "";
    const executor: LoopExecutor = {
      runWorker: async () => {
        if (loopId) await svc.stop(loopId);
        return { agentId: "w1", outcome: "completed" };
      },
      runShellCheck: async () => ({ exitCode: 1, stdout: "", stderr: "fail" }),
      runVerifier: async () => ({ passed: false, reason: "no" }),
      archiveAgent: async (id) => archived.push(id),
    };
    svc = new LoopService({ home, executor, sleep: noSleep, idGen: () => "loopaaaa" });
    loopId = "loopaaaa";
    const rec = await svc.run({
      prompt: "p",
      cwd: "/w",
      provider: "mock",
      verifyChecks: ["x"],
      maxIterations: 10,
    });
    expect(rec.status).toBe("stopped");
    // The in-flight iteration completed (1 worker), then stop was detected at the loop top.
    expect((rec.iterations as unknown[]).length).toBe(1);
  });

  it("logs carry a monotonic seq", async () => {
    const { executor } = makeExecutor({ verdicts: [true] });
    const svc = new LoopService({ home, executor, sleep: noSleep });
    const rec = await svc.run({
      prompt: "p",
      cwd: "/w",
      provider: "mock",
      verifyPrompt: "d?",
      maxIterations: 2,
    });
    const logs = await svc.logs(rec.id);
    const seqs = logs.map((l) => l.seq);
    expect(seqs).toEqual([...seqs].toSorted((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length); // unique
  });
});

describe("LoopService.recover", () => {
  it("recovers a running loop as stopped with an interruption log entry", async () => {
    // Seed a loops.json with a record stuck in `running`.
    const store = createLoopStore(home);
    await store.save([
      {
        id: "stuck001",
        prompt: "p",
        cwd: "/w",
        provider: "mock",
        verifyChecks: [],
        status: "running",
        createdAt: new Date().toISOString(),
        iterations: [],
        logs: [],
        nextLogSeq: 0,
      } as never,
    ]);

    const { executor } = makeExecutor();
    const svc = new LoopService({ home, executor });
    expect(await svc.recover()).toBe(1);
    const rec = await svc.inspect("stuck001");
    expect(rec!.status).toBe("stopped");
    const logs = await svc.logs("stuck001");
    expect(logs.at(-1)!.text).toContain("interrupted by daemon restart");
  });
});
