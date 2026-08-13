import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { persistedConfigSchema } from "../config/daemon-config.js";
import { silentLogger } from "../logging/logger.js";
import { effectivePiHomeKey, loadExtensionsState } from "./extensions-state.js";
import type { SyncPlan } from "./sync-planner.js";

// `resolveBundledPiCli` always resolves successfully in this dev environment (the real dependency
// is installed) — every test below relies on that for realistic behavior, EXCEPT the "skipped"
// case, which needs it to return null. Mock only that one export, toggled by `forceNoBundledCli`,
// keeping everything else in the module real. Same idiom as file-watch-service.test.ts's
// `fakeHomeDir`-backed `node:os` mock.
let forceNoBundledCli = false;
vi.mock("../agent/providers/pi/rpc-transport.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/providers/pi/rpc-transport.js")>();
  return {
    ...actual,
    resolveBundledPiCli: () => (forceNoBundledCli ? null : actual.resolveBundledPiCli()),
  };
});

const { classify, defaultInstallSpawn, executePlan } = await import("./sync-executor.js");
type InstallSpawn = import("./sync-executor.js").InstallSpawn;

function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-sync-executor-"));
}

const CONFIG = persistedConfigSchema.parse({});
const PI_HOME_KEY = effectivePiHomeKey(CONFIG);

function planOf(actions: { identity: string; pack: string; source: string }[]): SyncPlan {
  return { actions, entries: [] };
}

function action(identity: string): { identity: string; pack: string; source: string } {
  return { identity, pack: "core", source: `npm:${identity}` };
}

const failOnB: InstallSpawn = async ({ command }) => {
  const identity = command.at(-1) as string;
  if (identity === "npm:b") throw new Error("aborted mid-action");
  return { exitCode: 0, stderr: "" };
};

describe("executePlan — isolation (primary)", () => {
  it("one failure among four does not abort the run; 3 successes committed, 1 failure reported", async () => {
    const home = await tempHome();
    const calls: string[] = [];
    const spawn: InstallSpawn = async ({ command }) => {
      const identity = command.at(-1) as string;
      calls.push(identity);
      if (identity === "npm:b") return { exitCode: 1, stderr: "npm error 404 Not Found" };
      return { exitCode: 0, stderr: "" };
    };

    const plan = planOf(["a", "b", "c", "d"].map(action));
    const report = await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });

    expect(calls).toEqual(["npm:a", "npm:b", "npm:c", "npm:d"]);
    expect(report.outcome).toBe("partial");
    expect(report.installed.toSorted()).toEqual(["a", "c", "d"]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({
      identity: "b",
      source: "npm:b",
      pack: "core",
      reason: "not_found",
    });

    const state = await loadExtensionsState(home);
    if (state === "unreadable") throw new Error("state unreadable");
    const piHomeState = state.piHomes[PI_HOME_KEY];
    expect(Object.keys(piHomeState?.offered ?? {}).toSorted()).toEqual(["a", "c", "d"]);
  });

  it("a throwing seam cannot abort the run — every later action still attempted", async () => {
    const home = await tempHome();
    const calls: string[] = [];
    const spawn: InstallSpawn = async ({ command }) => {
      const identity = command.at(-1) as string;
      calls.push(identity);
      if (identity === "npm:b") throw new Error("boom: spawn exploded");
      return { exitCode: 0, stderr: "" };
    };

    const plan = planOf(["a", "b", "c"].map(action));
    const report = await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });

    expect(calls).toEqual(["npm:a", "npm:b", "npm:c"]);
    expect(report.installed.toSorted()).toEqual(["a", "c"]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.identity).toBe("b");
    expect(report.failures[0]?.message).toContain("boom: spawn exploded");
  });

  it("multiple failures with different causes are all reported, never truncated or collapsed", async () => {
    const home = await tempHome();
    const outcomes: Record<string, { exitCode: number; stderr: string } | "throw"> = {
      a: { exitCode: 0, stderr: "" },
      b: { exitCode: 1, stderr: "npm error 404 Not Found" },
      c: { exitCode: 1, stderr: "npm error code E401 Unauthorized" },
      d: { exitCode: 0, stderr: "" },
      e: "throw",
    };
    const spawn: InstallSpawn = async ({ command }) => {
      const identity = (command.at(-1) as string).slice("npm:".length);
      const outcome = outcomes[identity];
      if (outcome === "throw") throw new Error("timeout-ish failure");
      return outcome as { exitCode: number; stderr: string };
    };

    const plan = planOf(["a", "b", "c", "d", "e"].map(action));
    const report = await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });

    expect(report.outcome).toBe("partial");
    expect(report.installed.toSorted()).toEqual(["a", "d"]);
    expect(report.failures).toHaveLength(3);
    expect(report.failures.map((f) => f.identity).toSorted()).toEqual(["b", "c", "e"]);
    expect(report.failures.find((f) => f.identity === "b")?.reason).toBe("not_found");
    expect(report.failures.find((f) => f.identity === "c")?.reason).toBe("unauthorized");
  });
});

describe("executePlan — retry semantics", () => {
  it("re-running against the resulting state retries only the failed identities", async () => {
    const home = await tempHome();
    let call = 0;
    const spawn: InstallSpawn = async ({ command }) => {
      call++;
      const identity = command.at(-1) as string;
      return identity === "npm:b" ? { exitCode: 1, stderr: "fail" } : { exitCode: 0, stderr: "" };
    };

    const firstPlan = planOf(["a", "b", "c"].map(action));
    await executePlan(firstPlan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });
    expect(call).toBe(3);

    // A second sync's planner would only plan "b" again (a/c are now offered) — simulate that here.
    call = 0;
    const secondPlan = planOf([action("b")]);
    const report = await executePlan(secondPlan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });
    expect(call).toBe(1);
    expect(report.failures[0]?.identity).toBe("b");
  });

  it("attempts increments across failing runs; a later success clears the failures record", async () => {
    const home = await tempHome();
    let shouldFail = true;
    const spawn: InstallSpawn = async () =>
      shouldFail ? { exitCode: 1, stderr: "fail" } : { exitCode: 0, stderr: "" };

    const plan = planOf([action("a")]);
    await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });
    await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });

    let state = await loadExtensionsState(home);
    if (state === "unreadable") throw new Error("state unreadable");
    expect(state.piHomes[PI_HOME_KEY]?.failures.a?.attempts).toBe(2);

    shouldFail = false;
    await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });

    state = await loadExtensionsState(home);
    if (state === "unreadable") throw new Error("state unreadable");
    expect(state.piHomes[PI_HOME_KEY]?.failures.a).toBeUndefined();
    expect(state.piHomes[PI_HOME_KEY]?.offered.a).toBeDefined();
  });
});

describe("executePlan — per-action persistence", () => {
  it("state is persisted after every action, even one that never completes", async () => {
    const home = await tempHome();
    const spawn = failOnB;

    // Only actions a/b run to simulate "abort after action 2 of 4" — actions 3/4 are never even
    // submitted, mirroring what a process kill right after action 2 would leave on disk.
    const plan = planOf(["a", "b"].map(action));
    await executePlan(plan, {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });

    const state = await loadExtensionsState(home);
    if (state === "unreadable") throw new Error("state unreadable");
    const piHomeState = state.piHomes[PI_HOME_KEY];
    expect(piHomeState?.offered.a).toBeDefined();
    expect(piHomeState?.failures.b).toBeDefined();
  });
});

describe("executePlan — empty plan / no bundled pi", () => {
  it("empty plan ⇒ outcome noop, seam never called, no state write", async () => {
    const home = await tempHome();
    const spawn = vi.fn<InstallSpawn>();
    const report = await executePlan(planOf([]), {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });
    expect(report).toMatchObject({ outcome: "noop", installed: [], failures: [] });
    expect(spawn).not.toHaveBeenCalled();
    expect(await loadExtensionsState(home)).toEqual({ version: 1, piHomes: {} });
  });

  it("no bundled pi CLI ⇒ outcome skipped, zero failures rows, seam never called", async () => {
    forceNoBundledCli = true;
    try {
      const home = await tempHome();
      const spawn = vi.fn<InstallSpawn>();
      const report = await executePlan(planOf([action("a")]), {
        home,
        piHomeKey: PI_HOME_KEY,
        config: CONFIG,
        spawn,
        logger: silentLogger(),
      });
      expect(report.outcome).toBe("skipped");
      expect(report.failures).toEqual([]);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      forceNoBundledCli = false;
    }
  });
});

describe("executePlan — env assertions", () => {
  it("the seam receives the non-interactive guards and PI_CODING_AGENT_DIR = effectivePiHomeKey(config)", async () => {
    const home = await tempHome();
    let seenEnv: Record<string, string> | undefined;
    const spawn: InstallSpawn = async ({ env }) => {
      seenEnv = env;
      return { exitCode: 0, stderr: "" };
    };
    const config = persistedConfigSchema.parse({ daemon: { piHome: "/custom/.pi" } });
    await executePlan(planOf([action("a")]), {
      home,
      piHomeKey: effectivePiHomeKey(config),
      config,
      spawn,
      logger: silentLogger(),
    });
    expect(seenEnv?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(seenEnv?.GIT_SSH_COMMAND).toContain("BatchMode=yes");
    expect(seenEnv?.npm_config_yes).toBe("true");
    expect(seenEnv?.PI_CODING_AGENT_DIR).toBe(effectivePiHomeKey(config));
  });

  it("the override case: PI_CODING_AGENT_DIR still matches effectivePiHomeKey(config), not a stale piHomeKey", async () => {
    const home = await tempHome();
    let seenEnv: Record<string, string> | undefined;
    const spawn: InstallSpawn = async ({ env }) => {
      seenEnv = env;
      return { exitCode: 0, stderr: "" };
    };
    const config = persistedConfigSchema.parse({
      daemon: { piHome: "/custom/.pi" },
      agents: { providers: { pi: { env: { PI_CODING_AGENT_DIR: "/explicit/agent" } } } },
    });
    await executePlan(planOf([action("a")]), {
      home,
      piHomeKey: effectivePiHomeKey(config),
      config,
      spawn,
      logger: silentLogger(),
    });
    expect(seenEnv?.PI_CODING_AGENT_DIR).toBe("/explicit/agent");
  });
});

describe("executePlan — timeout", () => {
  it("a seam result of timedOut: true is reported reason 'timeout' and the run continues", async () => {
    const home = await tempHome();
    const calls: string[] = [];
    const spawn: InstallSpawn = async ({ command }) => {
      const identity = command.at(-1) as string;
      calls.push(identity);
      if (identity === "npm:a") return { exitCode: null, stderr: "", timedOut: true };
      return { exitCode: 0, stderr: "" };
    };
    const report = await executePlan(planOf(["a", "b"].map(action)), {
      home,
      piHomeKey: PI_HOME_KEY,
      config: CONFIG,
      spawn,
      logger: silentLogger(),
    });
    expect(calls).toEqual(["npm:a", "npm:b"]);
    expect(report.failures.find((f) => f.identity === "a")?.reason).toBe("timeout");
    expect(report.installed).toEqual(["b"]);
  });
});

// `defaultInstallSpawn`'s own timeout enforcement drives a real `setTimeout` against a real OS
// process tree (`tree-kill`); faking timers can't simulate an actual hung child or a real kill
// signal reaching it, so this one test genuinely needs the platform clock — kept to a
// millisecond-scale timeout so it stays fast (task-005's own acceptance criterion).
describe("defaultInstallSpawn — the production seam", () => {
  it("kills a hung process tree on timeout (real short-lived child, millisecond-scale timeout)", async () => {
    const result = await defaultInstallSpawn({
      command: [process.execPath, "-e", "setInterval(() => {}, 1000);"],
      env: { ...process.env } as Record<string, string>,
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("resolves with the exit code and captured stderr for a normal short-lived child", async () => {
    const result = await defaultInstallSpawn({
      command: [process.execPath, "-e", "process.stderr.write('hi'); process.exit(0);"],
      env: { ...process.env } as Record<string, string>,
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "hi" });
  });

  it("rejects when the binary cannot be spawned at all", async () => {
    await expect(
      defaultInstallSpawn({
        command: ["definitely-not-a-real-binary-xyz-123"],
        env: {},
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });
});

describe("classify", () => {
  it("maps each taxonomy value from a spawn result or a thrown error", () => {
    expect(classify({ exitCode: 1, stderr: "npm error code E404\n404 Not Found" })).toBe(
      "not_found",
    );
    expect(classify({ exitCode: 1, stderr: "npm error code E401 Unauthorized" })).toBe(
      "unauthorized",
    );
    expect(classify({ exitCode: 1, stderr: "npm error code E403 Forbidden" })).toBe("unauthorized");
    expect(classify({ exitCode: 1, stderr: "getaddrinfo ENOTFOUND registry.npmjs.org" })).toBe(
      "network",
    );
    expect(classify({ exitCode: 1, stderr: "connect ECONNREFUSED 127.0.0.1:443" })).toBe("network");
    expect(classify({ exitCode: null, stderr: "", timedOut: true })).toBe("timeout");
    expect(classify({ exitCode: 1, stderr: "some other npm build failure" })).toBe(
      "install_failed",
    );
    expect(classify(new Error("spawn pi ENOENT"))).toBe("spawn_failed");
    expect(classify(new Error("totally unrecognizable"))).toBe("unknown");
    expect(classify("a bare string throw")).toBe("unknown");
  });
});
