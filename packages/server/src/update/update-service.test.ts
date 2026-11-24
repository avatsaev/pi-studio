import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as flush } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";

import {
  classifyInstallFailure,
  createFileSkipStore,
  createUpdatePipeline,
  failureMessage,
  HANDOFF_PAUSE_MS,
  MANUAL_UPDATE_COMMANDS,
  readAndRemoveUpdateResult,
  RESULT_POLL_MS,
  RESULT_WATCH_MS,
  UpdateService,
  type UpdateLastResult,
  type UpdatePipeline,
  type UpdatePipelineDeps,
  type UpdateServiceDeps,
  type UpdateTimer,
} from "./update-service.js";

/** Never settles: the update stays in `installing`. */
const hangingPipeline: UpdatePipeline = () => Promise.withResolvers<void>().promise;

async function tempFile(content?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-update-result-"));
  const path = join(dir, "update-result.json");
  if (content !== undefined) await writeFile(path, content, "utf8");
  return path;
}

interface FakeTimer extends UpdateTimer {
  sets: Array<{ fn: () => void; ms: number }>;
  cleared: unknown[];
}

function fakeTimer(): FakeTimer {
  const timer: FakeTimer = {
    sets: [],
    cleared: [],
    set: (fn, ms) => {
      const handle = { fn, ms };
      timer.sets.push(handle);
      return handle;
    },
    clear: (handle) => {
      timer.cleared.push(handle);
    },
  };
  return timer;
}

function setup(overrides: Partial<UpdateServiceDeps> = {}) {
  const broadcasts: DaemonUpdateStatus[] = [];
  const timer = fakeTimer();
  const resultTimer = fakeTimer();
  const deps: UpdateServiceDeps = {
    currentVersion: "0.0.10",
    detectInstallKind: async () => "npm-global",
    fetchLatest: async () => "0.0.11",
    npmOnPath: async () => true,
    globalFolder: async () => "/usr/lib/node_modules",
    canWriteGlobalFolder: async () => true,
    platform: "linux",
    autoCheck: true,
    takeLastResult: async () => undefined,
    persistAutoCheck: async (enabled) => enabled,
    broadcast: (status) => broadcasts.push(status),
    now: () => 1_000,
    pipeline: async () => undefined,
    timer,
    resultTimer,
    ...overrides,
  };
  return { service: new UpdateService(deps), broadcasts, timer, resultTimer, deps };
}

describe("UpdateService check", () => {
  it("starts idle with the install kind unknown until start() finds it", () => {
    const { service } = setup();
    expect(service.status()).toEqual({
      currentVersion: "0.0.10",
      installKind: "unknown",
      autoCheck: true,
      state: { kind: "idle" },
    });
  });

  it("reaches available when a newer version exists on an updatable npm-global install", async () => {
    const { service } = setup();
    const status = await service.check("manual");
    expect(status.state).toEqual({ kind: "available", version: "0.0.11" });
    expect(status.checkedAt).toBe(1_000);
    expect(status.checkError).toBeUndefined();
  });

  it.each(["0.0.10", "0.0.9"])("stays idle when latest is %s (not newer)", async (latest) => {
    const { service } = setup({ fetchLatest: async () => latest });
    const status = await service.check("manual");
    expect(status.state).toEqual({ kind: "idle" });
    expect(status.checkedAt).toBe(1_000);
  });

  it.each([
    ["docker", "docker"],
    ["source", "source"],
    ["unknown", "unknown_install"],
  ] as const)("a %s install with a newer version is cannot_update(%s)", async (kind, reason) => {
    const { service } = setup({ detectInstallKind: async () => kind });
    await service.start();
    const status = await service.check("manual");
    expect(status.state).toEqual({
      kind: "cannot_update",
      reason,
      version: "0.0.11",
      command: MANUAL_UPDATE_COMMANDS[reason],
    });
  });

  it("a daemon that cannot update stays idle when nothing newer exists", async () => {
    const { service } = setup({
      detectInstallKind: async () => "docker",
      fetchLatest: async () => "0.0.10",
    });
    await service.start();
    expect((await service.check("manual")).state).toEqual({ kind: "idle" });
  });

  it("npm missing is cannot_update(npm_missing), checked before the folder probe", async () => {
    const canWrite = vi.fn(async () => false);
    const { service } = setup({ npmOnPath: async () => false, canWriteGlobalFolder: canWrite });
    const status = await service.check("manual");
    expect(status.state).toMatchObject({ kind: "cannot_update", reason: "npm_missing" });
    expect(canWrite).not.toHaveBeenCalled();
  });

  it("a read-only global folder is cannot_update(not_writable), probing the folder npm reports", async () => {
    const canWrite = vi.fn(async () => false);
    const { service } = setup({ canWriteGlobalFolder: canWrite });
    const status = await service.check("manual");
    expect(status.state).toMatchObject({
      kind: "cannot_update",
      reason: "not_writable",
      command: MANUAL_UPDATE_COMMANDS.not_writable,
    });
    expect(canWrite).toHaveBeenCalledWith("/usr/lib/node_modules");
  });

  it("Windows is cannot_update(unsupported_platform), after npm and folder", async () => {
    const { service } = setup({ platform: "win32" });
    await service.start();
    expect((await service.check("manual")).state).toMatchObject({
      kind: "cannot_update",
      reason: "unsupported_platform",
      version: "0.0.11",
    });
    const missing = setup({ platform: "win32", npmOnPath: async () => false });
    expect((await missing.service.check("manual")).state).toMatchObject({ reason: "npm_missing" });
  });

  it("offline: checkError set, previous state kept, checkedAt recorded (manual)", async () => {
    const { service } = setup();
    await service.check("manual");
    const failing = setup({ fetchLatest: async () => null });
    await failing.service.check("manual");
    const status = failing.service.status();
    expect(status.checkError).toBe("offline");
    expect(status.state).toEqual({ kind: "idle" });
    expect(status.checkedAt).toBe(1_000);
  });

  it("a failed manual check keeps the earlier available state", async () => {
    let answer: string | null = "0.0.11";
    const { service } = setup({ fetchLatest: async () => answer });
    await service.check("manual");
    answer = null;
    const status = await service.check("manual");
    expect(status.checkError).toBe("offline");
    expect(status.state).toEqual({ kind: "available", version: "0.0.11" });
  });

  it.each(["", "garbage", "1.2", "1.2.3-beta.1", "v1.2.3"])("bad_answer for %j", async (answer) => {
    const { service } = setup({ fetchLatest: async () => answer });
    const status = await service.check("manual");
    expect(status.checkError).toBe("bad_answer");
    expect(status.state).toEqual({ kind: "idle" });
  });

  it("a later good check clears checkError", async () => {
    let answer: string | null = null;
    const { service } = setup({ fetchLatest: async () => answer });
    await service.check("manual");
    answer = "0.0.11";
    const status = await service.check("manual");
    expect(status.checkError).toBeUndefined();
  });

  it("a failed automatic check changes nothing and broadcasts nothing", async () => {
    const { service, broadcasts } = setup({ fetchLatest: async () => null });
    await service.start();
    broadcasts.length = 0;
    const before = service.status();
    const status = await service.check("automatic");
    expect(status).toEqual(before);
    expect(broadcasts).toEqual([]);
  });

  it("a manual check broadcasts checking then the result; an automatic one only the result", async () => {
    const manual = setup();
    await manual.service.check("manual");
    expect(manual.broadcasts.map((s) => s.state.kind)).toEqual(["checking", "available"]);

    const auto = setup();
    await auto.service.check("automatic");
    expect(auto.broadcasts.map((s) => s.state.kind)).toEqual(["available"]);
  });

  it("does not broadcast when an automatic check finds nothing new to say", async () => {
    const { service, broadcasts } = setup({ fetchLatest: async () => "0.0.10" });
    await service.check("automatic");
    // checkedAt changed, so the first check broadcasts; an identical repeat does not.
    const count = broadcasts.length;
    await service.check("automatic");
    expect(broadcasts.length).toBe(count);
  });

  it("is single flight: concurrent checks share one npm call", async () => {
    const fetchLatest = vi.fn(async () => "0.0.11");
    const { service } = setup({ fetchLatest });
    await Promise.all([service.check("manual"), service.check("automatic")]);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("does nothing while an update runs", async () => {
    const gate = Promise.withResolvers<void>();
    const pipeline: UpdatePipeline = () => gate.promise;
    const fetchLatest = vi.fn(async () => "0.0.11");
    const { service } = setup({ fetchLatest, pipeline });
    await service.check("manual");
    service.apply();
    fetchLatest.mockClear();
    const status = await service.check("manual");
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(status.state).toEqual({ kind: "installing", version: "0.0.11" });
    gate.resolve();
    await service.whenApplySettled();
  });

  it("an apply that starts during an automatic check keeps the state", async () => {
    const answer = Promise.withResolvers<string>();
    let first = true;
    const fetchLatest = async (): Promise<string> => {
      if (!first) return answer.promise;
      first = false;
      return "0.0.11";
    };
    const { service } = setup({ fetchLatest, pipeline: hangingPipeline });
    await service.check("manual");
    const pending = service.check("automatic");
    expect(service.apply()).toEqual({ ok: true });
    answer.resolve("0.0.12");
    const status = await pending;
    expect(status.state).toEqual({ kind: "installing", version: "0.0.11" });
  });
});

describe("UpdateService start and timer", () => {
  it("start(): detects the kind, loads lastResult, checks once, arms an unref'd-style timer at 6 h", async () => {
    const lastResult: UpdateLastResult = { from: "0.0.9", to: "0.0.10", outcome: "updated", at: 5 };
    const fetchLatest = vi.fn(async () => "0.0.11");
    const { service, timer, broadcasts } = setup({
      fetchLatest,
      takeLastResult: async () => lastResult,
    });
    await service.start();
    const status = service.status();
    expect(status.installKind).toBe("npm-global");
    expect(status.lastResult).toEqual(lastResult);
    expect(status.state).toEqual({ kind: "available", version: "0.0.11" });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(timer.sets).toHaveLength(1);
    expect(timer.sets[0]?.ms).toBe(6 * 60 * 60 * 1000);
    expect(service.timerArmed).toBe(true);
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  it("the timer runs an automatic check each tick", async () => {
    const fetchLatest = vi.fn(async () => "0.0.10");
    const { service, timer } = setup({ fetchLatest });
    await service.start();
    fetchLatest.mockClear();
    timer.sets[0]?.fn();
    await service.check("automatic");
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("autoCheck off: no check at start, no timer; a manual check still works", async () => {
    const fetchLatest = vi.fn(async () => "0.0.11");
    const { service, timer } = setup({ autoCheck: false, fetchLatest });
    await service.start();
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(timer.sets).toHaveLength(0);
    expect((await service.check("manual")).state).toMatchObject({ kind: "available" });
  });

  it("close() clears the timer, once", async () => {
    const { service, timer } = setup();
    await service.start();
    service.close();
    service.close();
    expect(timer.cleared).toEqual([timer.sets[0]]);
    expect(service.timerArmed).toBe(false);
  });

  it("a start-up probe failure is logged, never thrown", async () => {
    const { service } = setup({
      detectInstallKind: async () => {
        throw new Error("boom");
      },
      autoCheck: false,
    });
    await expect(service.start()).resolves.toBeUndefined();
    expect(service.status().installKind).toBe("unknown");
  });

  it("takes a result the helper writes after start-up (it writes once the new daemon answers): polls, reads once, broadcasts, stops", async () => {
    const result: UpdateLastResult = { from: "0.0.9", to: "0.0.10", outcome: "updated", at: 7 };
    let written: UpdateLastResult | undefined;
    const takeLastResult = vi.fn(async () => {
      const taken = written;
      written = undefined;
      return taken;
    });
    const { service, resultTimer, broadcasts } = setup({ takeLastResult, autoCheck: false });
    await service.start();
    expect(service.status().lastResult).toBeUndefined();
    expect(resultTimer.sets).toHaveLength(1);
    expect(resultTimer.sets[0]?.ms).toBe(RESULT_POLL_MS);

    resultTimer.sets[0]?.fn();
    await flush();
    expect(takeLastResult).toHaveBeenCalledTimes(2); // the start-up read, one poll
    expect(service.status().lastResult).toBeUndefined();

    written = result;
    resultTimer.sets[0]?.fn();
    await flush();
    expect(service.status().lastResult).toEqual(result);
    expect(broadcasts.at(-1)?.lastResult).toEqual(result);
    expect(resultTimer.cleared).toEqual([resultTimer.sets[0]]);
  });

  it("does not watch when the start-up read found the result", async () => {
    const lastResult: UpdateLastResult = { from: "0.0.9", to: "0.0.10", outcome: "failed", at: 5 };
    const { service, resultTimer } = setup({ takeLastResult: async () => lastResult });
    await service.start();
    expect(resultTimer.sets).toHaveLength(0);
  });

  it("stops looking for a result after the watch window, and when closed", async () => {
    let now = 1_000;
    const { service, resultTimer } = setup({ now: () => now, autoCheck: false });
    await service.start();
    now += RESULT_WATCH_MS - 1;
    resultTimer.sets[0]?.fn();
    await flush();
    expect(resultTimer.cleared).toHaveLength(0);
    now += 1;
    resultTimer.sets[0]?.fn();
    await flush();
    expect(resultTimer.cleared).toEqual([resultTimer.sets[0]]);

    const second = setup({ autoCheck: false });
    await second.service.start();
    second.service.close();
    expect(second.resultTimer.cleared).toEqual([second.resultTimer.sets[0]]);
  });
});

describe("UpdateService setAutoCheck", () => {
  it("persists, starts the timer when enabled, stops it when disabled, broadcasts", async () => {
    const persist = vi.fn(async (enabled: boolean) => enabled);
    const { service, timer, broadcasts } = setup({ autoCheck: false, persistAutoCheck: persist });
    const on = await service.setAutoCheck(true);
    expect(persist).toHaveBeenCalledWith(true);
    expect(on.autoCheck).toBe(true);
    expect(timer.sets).toHaveLength(1);
    const off = await service.setAutoCheck(false);
    expect(off.autoCheck).toBe(false);
    expect(timer.cleared).toEqual([timer.sets[0]]);
    expect(broadcasts.map((s) => s.autoCheck)).toEqual([true, false]);
  });

  it("enabling twice arms one timer", async () => {
    const { service, timer } = setup({ autoCheck: false });
    await service.setAutoCheck(true);
    await service.setAutoCheck(true);
    expect(timer.sets).toHaveLength(1);
  });

  it("reports the effective value when env overrides the write", async () => {
    const { service, timer } = setup({ persistAutoCheck: async () => false });
    const status = await service.setAutoCheck(true);
    expect(status.autoCheck).toBe(false);
    expect(timer.sets).toHaveLength(0);
  });
});

describe("UpdateService apply", () => {
  it("refuses not_available when idle", async () => {
    const { service } = setup({ fetchLatest: async () => "0.0.10" });
    await service.check("manual");
    expect(service.apply()).toEqual({ ok: false, error: "not_available" });
  });

  it("refuses not_available before any check and while checking", async () => {
    const { service } = setup();
    expect(service.apply()).toEqual({ ok: false, error: "not_available" });
  });

  it("refuses cannot_update for every blocked install", async () => {
    for (const kind of ["docker", "source", "unknown"] as const) {
      const { service } = setup({ detectInstallKind: async () => kind });
      await service.start();
      await service.check("manual");
      expect(service.apply()).toEqual({ ok: false, error: "cannot_update" });
    }
    const readOnly = setup({ canWriteGlobalFolder: async () => false });
    await readOnly.service.check("manual");
    expect(readOnly.service.apply()).toEqual({ ok: false, error: "cannot_update" });
  });

  it("answers ok, broadcasts installing, runs the pipeline with target and previous", async () => {
    const seen: Array<{ target: string; previous: string }> = [];
    const pipeline: UpdatePipeline = async ({ target, previous, setState }) => {
      await Promise.resolve();
      seen.push({ target, previous });
      setState({ kind: "updating_extensions", version: target });
      setState({ kind: "restarting", version: target });
    };
    const { service, broadcasts } = setup({ pipeline });
    await service.check("manual");
    broadcasts.length = 0;
    expect(service.apply()).toEqual({ ok: true });
    expect(service.status().state).toEqual({ kind: "installing", version: "0.0.11" });
    await service.whenApplySettled();
    expect(seen).toEqual([{ target: "0.0.11", previous: "0.0.10" }]);
    expect(broadcasts.map((s) => s.state.kind)).toEqual([
      "installing",
      "updating_extensions",
      "restarting",
    ]);
  });

  it("a second apply during an update is refused in_progress", async () => {
    const { service } = setup({ pipeline: hangingPipeline });
    await service.check("manual");
    expect(service.apply()).toEqual({ ok: true });
    expect(service.apply()).toEqual({ ok: false, error: "in_progress" });
  });

  it("a throwing pipeline ends in failed(install) with the message", async () => {
    const { service } = setup({
      pipeline: async () => {
        throw new Error("npm exploded");
      },
    });
    await service.check("manual");
    service.apply();
    await service.whenApplySettled();
    expect(service.status().state).toEqual({
      kind: "failed",
      version: "0.0.11",
      code: "install",
      message: "npm exploded",
    });
  });

  it("a failed state is replaced by the next check (available again)", async () => {
    const { service } = setup({
      pipeline: async ({ target, setState }) =>
        setState({ kind: "failed", version: target, code: "install" }),
    });
    await service.check("manual");
    service.apply();
    await service.whenApplySettled();
    expect(service.status().state).toMatchObject({ kind: "failed" });
    const status = await service.check("manual");
    expect(status.state).toEqual({ kind: "available", version: "0.0.11" });
  });
});

interface PipelineRig {
  service: UpdateService;
  /** One shared, ordered log of every observable step: broadcasts and each seam call. */
  calls: string[];
}

function pipelineRig(overrides: Partial<UpdatePipelineDeps> = {}): PipelineRig {
  const calls: string[] = [];
  const deps: UpdatePipelineDeps = {
    install: async (version) => {
      calls.push(`install ${version}`);
    },
    updateExtensions: async () => {
      calls.push("extensions");
    },
    spawnHelper: (target, previous) => {
      calls.push(`helper ${target} ${previous}`);
    },
    shutdown: async () => {
      calls.push("shutdown");
    },
    exit: (code) => {
      calls.push(`exit ${code}`);
    },
    pause: async (ms) => {
      calls.push(`pause ${ms}`);
    },
    ...overrides,
  };
  const { service } = setup({
    pipeline: createUpdatePipeline(deps),
    broadcast: (status) => calls.push(`state ${status.state.kind}`),
  });
  return { service, calls };
}

async function applyAvailable(rig: PipelineRig): Promise<void> {
  await rig.service.check("manual");
  rig.calls.length = 0;
  expect(rig.service.apply()).toEqual({ ok: true });
  await rig.service.whenApplySettled();
}

describe("apply pipeline", () => {
  it("hands over in order: install, extensions, helper, pause, shutdown once, exit", async () => {
    const rig = pipelineRig();
    await applyAvailable(rig);
    expect(rig.calls).toEqual([
      "state installing",
      "install 0.0.11",
      "state updating_extensions",
      "extensions",
      "state restarting",
      "helper 0.0.11 0.0.10",
      `pause ${HANDOFF_PAUSE_MS}`,
      "shutdown",
      "exit 0",
    ]);
  });

  it("an install failure is failed: no extensions, no helper, no shutdown, no exit", async () => {
    const rig = pipelineRig({
      install: async () => {
        throw new Error("EACCES: permission denied, mkdir '/usr/lib/node_modules/x'");
      },
    });
    await applyAvailable(rig);
    expect(rig.service.status().state).toEqual({
      kind: "failed",
      version: "0.0.11",
      code: "permission",
      message: "EACCES: permission denied, mkdir '/usr/lib/node_modules/x'",
    });
    expect(rig.calls).toEqual(["state installing", "state failed"]);
  });

  it("an extensions failure is logged and the update goes on", async () => {
    const warn = vi.fn();
    const rig = pipelineRig({
      updateExtensions: async () => {
        throw new Error("pi not found");
      },
      logger: { warn } as unknown as UpdatePipelineDeps["logger"],
    });
    await applyAvailable(rig);
    expect(warn).toHaveBeenCalled();
    expect(rig.calls).toContain("helper 0.0.11 0.0.10");
    expect(rig.calls.slice(-2)).toEqual(["shutdown", "exit 0"]);
  });

  it("a helper that cannot start leaves the daemon running: failed, no shutdown, no exit", async () => {
    const rig = pipelineRig({
      spawnHelper: () => {
        throw new Error("failed to spawn the update helper");
      },
    });
    await applyAvailable(rig);
    expect(rig.service.status().state).toMatchObject({
      kind: "failed",
      code: "install",
      message: "failed to spawn the update helper",
    });
    expect(rig.calls).not.toContain("shutdown");
    expect(rig.calls.some((c) => c.startsWith("exit"))).toBe(false);
  });

  it("a shutdown that throws still exits: the helper is waiting for this process", async () => {
    const rig = pipelineRig({
      shutdown: async () => {
        throw new Error("close failed");
      },
    });
    await applyAvailable(rig);
    expect(rig.calls.at(-1)).toBe("exit 0");
  });

  it("a daemon that does not own its process fails before installing anything", async () => {
    const install = vi.fn();
    const rig = pipelineRig({ exit: undefined, install });
    await applyAvailable(rig);
    expect(install).not.toHaveBeenCalled();
    expect(rig.service.status().state).toMatchObject({ kind: "failed", code: "install" });
  });

  it("a second apply during the pipeline is refused in_progress and shuts down once", async () => {
    const gate = Promise.withResolvers<void>();
    const rig = pipelineRig({ install: () => gate.promise });
    await rig.service.check("manual");
    rig.calls.length = 0;
    expect(rig.service.apply()).toEqual({ ok: true });
    expect(rig.service.apply()).toEqual({ ok: false, error: "in_progress" });
    gate.resolve();
    await rig.service.whenApplySettled();
    expect(rig.service.apply()).toEqual({ ok: false, error: "in_progress" });
    expect(rig.calls.filter((c) => c === "shutdown")).toHaveLength(1);
    expect(rig.calls.filter((c) => c.startsWith("exit"))).toHaveLength(1);
  });
});

describe("install failure codes and messages", () => {
  it.each([
    ["EACCES: permission denied, rename '/usr/lib/node_modules/a'", "permission"],
    ["npm error code EPERM: operation not permitted", "permission"],
    ["npm install timed out after 120 s", "timeout"],
    ["npm error code ENOTFOUND getaddrinfo ENOTFOUND registry.npmjs.org", "network"],
    ["npm error network read ECONNRESET", "network"],
    ["npm error code EAI_AGAIN", "network"],
    ["npm error code E404 Not Found", "install"],
    ["", "install"],
  ] as const)("%j is %s", (message, code) => {
    expect(classifyInstallFailure(message)).toBe(code);
  });

  it("the message is the redacted last 2048 characters", () => {
    expect(failureMessage(new Error("fetch https://user:secret@registry.example/x failed"))).toBe(
      "fetch https://registry.example/x failed",
    );
    const long = `${"a".repeat(3000)}END`;
    const message = failureMessage(new Error(long));
    expect(message).toHaveLength(2048);
    expect(message.endsWith("END")).toBe(true);
  });
});

describe("readAndRemoveUpdateResult", () => {
  it("reads the result and removes the file", async () => {
    const result: UpdateLastResult = { from: "0.0.9", to: "0.0.10", outcome: "updated", at: 7 };
    const path = await tempFile(JSON.stringify(result));
    expect(await readAndRemoveUpdateResult(path)).toEqual(result);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns undefined when there is no file", async () => {
    expect(await readAndRemoveUpdateResult(await tempFile())).toBeUndefined();
  });

  it("removes and logs a malformed file, returns undefined", async () => {
    const path = await tempFile("{ not json");
    const warn = vi.fn();
    const logger = { warn } as unknown as Parameters<typeof readAndRemoveUpdateResult>[1];
    expect(await readAndRemoveUpdateResult(path, logger)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes and logs a file of the wrong shape", async () => {
    const path = await tempFile(JSON.stringify({ from: 1 }));
    expect(await readAndRemoveUpdateResult(path)).toBeUndefined();
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function memorySkipStore(initial?: string) {
  const store = {
    value: initial,
    read: async () => store.value,
    write: async (version: string) => {
      store.value = version;
    },
    clear: async () => {
      store.value = undefined;
    },
  };
  return store;
}

const rolledBack: UpdateLastResult = {
  from: "0.0.10",
  to: "0.0.11",
  outcome: "rolled_back",
  at: 5,
};

describe("skipped version (D14)", () => {
  it.each(["rolled_back", "failed"])("a %s result writes the skip file", async (outcome) => {
    const skipStore = memorySkipStore();
    const { service } = setup({
      skipStore,
      takeLastResult: async () => ({ ...rolledBack, outcome }),
    });
    await service.ready();
    expect(skipStore.value).toBe("0.0.11");
    expect(service.status().skippedVersion).toBe("0.0.11");
  });

  it("an updated result writes nothing", async () => {
    const skipStore = memorySkipStore();
    const { service } = setup({
      skipStore,
      takeLastResult: async () => ({ ...rolledBack, outcome: "updated" }),
    });
    await service.ready();
    expect(skipStore.value).toBeUndefined();
    expect(service.status().skippedVersion).toBeUndefined();
  });

  it("an automatic check that finds the skipped version stays idle; a manual one offers it", async () => {
    const { service } = setup({ skipStore: memorySkipStore("0.0.11") });
    expect((await service.check("automatic")).state).toEqual({ kind: "idle" });
    expect((await service.check("manual")).state).toEqual({ kind: "available", version: "0.0.11" });
    expect(service.status().skippedVersion).toBe("0.0.11");
  });

  it("a rollback result that arrives after the start's automatic check takes that check's offer of the version back", async () => {
    let written: UpdateLastResult | undefined;
    const skipStore = memorySkipStore();
    const { service, resultTimer, broadcasts } = setup({
      skipStore,
      takeLastResult: async () => {
        const taken = written;
        written = undefined;
        return taken;
      },
    });
    await service.start();
    expect(service.status().state).toEqual({ kind: "available", version: "0.0.11" });

    written = rolledBack; // the helper writes it once the rolled-back daemon answers: after that check
    resultTimer.sets[0]?.fn();
    await flush();
    const status = service.status();
    expect(status.lastResult).toEqual(rolledBack);
    expect(status.skippedVersion).toBe("0.0.11");
    expect(skipStore.value).toBe("0.0.11");
    expect(status.state).toEqual({ kind: "idle" });
    expect(broadcasts.at(-1)?.state).toEqual({ kind: "idle" });
  });

  it("a late rollback result leaves a manual offer, and an offer of another version, alone", async () => {
    const manual = setup({ autoCheck: false, skipStore: memorySkipStore() });
    await manual.service.start();
    await manual.service.check("manual");
    manual.deps.takeLastResult = async () => rolledBack;
    manual.resultTimer.sets[0]?.fn();
    await flush();
    expect(manual.service.status().state).toEqual({ kind: "available", version: "0.0.11" });

    const newer = setup({ fetchLatest: async () => "0.0.12", skipStore: memorySkipStore() });
    await newer.service.start();
    newer.deps.takeLastResult = async () => rolledBack;
    newer.resultTimer.sets[0]?.fn();
    await flush();
    expect(newer.service.status().state).toEqual({ kind: "available", version: "0.0.12" });
    expect(newer.service.status().skippedVersion).toBe("0.0.11");
  });

  it("a newer version is offered and clears the skip", async () => {
    const skipStore = memorySkipStore("0.0.11");
    const { service } = setup({ skipStore, fetchLatest: async () => "0.0.12" });
    const status = await service.check("automatic");
    expect(status.state).toEqual({ kind: "available", version: "0.0.12" });
    expect(status.skippedVersion).toBeUndefined();
    expect(skipStore.value).toBeUndefined();
  });

  it("a file store round-trips and removes an unreadable file", async () => {
    const path = await tempFile("not json");
    const store = createFileSkipStore(path);
    expect(await store.read()).toBeUndefined();
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await store.write("1.2.3");
    expect(await store.read()).toBe("1.2.3");
    await store.clear();
    expect(await store.read()).toBeUndefined();
  });
});
