import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  healthUrlOf,
  parseHelperParams,
  realBinaryHelperSeams,
  runBinaryHelper,
  type BinaryHelperSeams,
} from "./binary-helper.js";
import {
  HELPER_EXIT_WAIT_MS,
  type HelperParams,
  type HelperResult,
  type StartedDaemon,
} from "./helper.js";

const PARAMS: HelperParams = {
  oldPid: 4242,
  target: "0.0.11",
  previous: "0.0.10",
  listen: "127.0.0.1:6767",
  home: "/tmp/unused",
  packageName: "@av-pi-studio/cli",
};

/** What a started daemon answers on `/api/health`: a version, or nothing. */
interface Behaviour {
  version: string | null;
  exitsAtOnce?: boolean;
}

interface Fake {
  seams: BinaryHelperSeams;
  /** Every effect in order. */
  events: string[];
  results: HelperResult[];
  log: string[];
}

function fake(
  behaviour: Record<string, Behaviour>,
  overrides: Partial<BinaryHelperSeams> & { oldExits?: boolean; badSwitch?: string } = {},
): Fake {
  let clock = 1_000;
  let current = "";
  const events: string[] = [];
  const results: HelperResult[] = [];
  const log: string[] = [];
  let running: { version: string | null; exited: boolean } | undefined;
  const seams: BinaryHelperSeams = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: (line) => log.push(line),
    waitForExit: async (pid, timeoutMs) => {
      events.push(`wait ${pid} ${timeoutMs}`);
      return overrides.oldExits ?? true;
    },
    switchCurrent: async (version) => {
      if (version === overrides.badSwitch) throw new Error("no such version");
      current = version;
      events.push(`switch ${version}`);
    },
    startDaemon: () => {
      const b = behaviour[current] ?? { version: null };
      events.push(`start ${current}`);
      const state = { version: b.version, exited: b.exitsAtOnce === true };
      running = state;
      const daemon: StartedDaemon = {
        pid: 100,
        hasExited: () => state.exited,
        stop: async () => {
          events.push(`stop ${current}`);
          state.exited = true;
          state.version = null;
        },
      };
      return daemon;
    },
    healthVersion: async () => (running && !running.exited ? running.version : null),
    writeResult: (result) => {
      results.push(result);
      events.push(`result ${result.outcome}`);
    },
    pruneVersions: async (keep) => {
      events.push(`prune ${[...keep].join(",")}`);
    },
    ...overrides,
  };
  return { seams, events, results, log };
}

describe("runBinaryHelper", () => {
  it("waits for the old daemon, switches, starts, then writes updated and prunes", async () => {
    const f = fake({ "0.0.11": { version: "0.0.11" } });
    const result = await runBinaryHelper(PARAMS, f.seams);
    expect(f.events).toEqual([
      `wait 4242 ${HELPER_EXIT_WAIT_MS}`,
      "switch 0.0.11",
      "start 0.0.11",
      "result updated",
      "prune 0.0.11,0.0.10",
    ]);
    expect(result).toMatchObject({ from: "0.0.10", to: "0.0.11", outcome: "updated" });
    expect(f.results).toEqual([result]);
    expect(result.message).toBeUndefined();
  });

  it("goes on when the old daemon is still there after the wait", async () => {
    const f = fake({ "0.0.11": { version: "0.0.11" } }, { oldExits: false });
    expect((await runBinaryHelper(PARAMS, f.seams)).outcome).toBe("updated");
    expect(f.log.some((l) => l.includes("still running"))).toBe(true);
  });

  it("tries three times, switches back, starts the previous and writes rolled_back", async () => {
    const f = fake({ "0.0.11": { version: "0.0.9" }, "0.0.10": { version: "0.0.10" } });
    const result = await runBinaryHelper(PARAMS, f.seams);
    expect(f.events).toEqual([
      `wait 4242 ${HELPER_EXIT_WAIT_MS}`,
      "switch 0.0.11",
      "start 0.0.11",
      "stop 0.0.11",
      "start 0.0.11",
      "stop 0.0.11",
      "start 0.0.11",
      "stop 0.0.11",
      "switch 0.0.10",
      "start 0.0.10",
      "result rolled_back",
    ]);
    expect(result).toMatchObject({ from: "0.0.10", to: "0.0.11", outcome: "rolled_back" });
    expect(result.message).toContain("0.0.11");
  });

  it("does not wait the whole window for a daemon that exited", async () => {
    const f = fake({
      "0.0.11": { version: null, exitsAtOnce: true },
      "0.0.10": { version: "0.0.10" },
    });
    const before = f.seams.now();
    await runBinaryHelper(PARAMS, f.seams);
    expect(f.seams.now() - before).toBeLessThan(1_000);
  });

  it("writes failed, with the command to run, when neither version starts", async () => {
    const f = fake({});
    const result = await runBinaryHelper(PARAMS, f.seams);
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("Neither 0.0.11 nor 0.0.10 started");
    expect(result.message).toContain("pi-studio daemon start");
    expect(f.events.filter((e) => e.startsWith("prune"))).toEqual([]);
    expect(f.log.at(-1)).toContain("pi-studio daemon start");
  });

  it("starts the previous version when the target cannot be switched to", async () => {
    const f = fake({ "0.0.10": { version: "0.0.10" } }, { badSwitch: "0.0.11" });
    const result = await runBinaryHelper(PARAMS, f.seams);
    expect(f.events).toEqual([
      `wait 4242 ${HELPER_EXIT_WAIT_MS}`,
      "switch 0.0.10",
      "start 0.0.10",
      "result rolled_back",
    ]);
    expect(result.outcome).toBe("rolled_back");
  });

  it("keeps the result when removing old versions fails, and when a spawn fails once", async () => {
    let spawns = 0;
    const f = fake(
      { "0.0.11": { version: "0.0.11" } },
      {
        pruneVersions: async () => {
          throw new Error("EBUSY");
        },
      },
    );
    const start = f.seams.startDaemon;
    f.seams.startDaemon = () => {
      spawns += 1;
      if (spawns === 1) throw new Error("spawn failed");
      return start();
    };
    expect((await runBinaryHelper(PARAMS, f.seams)).outcome).toBe("updated");
    expect(spawns).toBe(2);
    expect(f.log.some((l) => l.includes("EBUSY"))).toBe(true);
  });
});

describe("parseHelperParams", () => {
  it("reads the JSON the daemon passed", () => {
    expect(parseHelperParams(JSON.stringify(PARAMS))).toEqual(PARAMS);
  });
  it.each([
    [undefined],
    ["{"],
    ["[]"],
    [JSON.stringify({ ...PARAMS, oldPid: "x" })],
    [JSON.stringify({ ...PARAMS, listen: "nope" })],
  ])("rejects %s", (json) => {
    expect(() => parseHelperParams(json)).toThrow(/__update-helper/);
  });
});

describe("healthUrlOf", () => {
  it("maps wildcard hosts to loopback and brackets IPv6", () => {
    expect(healthUrlOf("127.0.0.1:6767")).toBe("http://127.0.0.1:6767/api/health");
    expect(healthUrlOf("0.0.0.0:6767")).toBe("http://127.0.0.1:6767/api/health");
    expect(healthUrlOf("[::]:6767")).toBe("http://127.0.0.1:6767/api/health");
    expect(healthUrlOf("::1:6767")).toBe("http://[::1]:6767/api/health");
  });
});

// ── The real seams, over a temp home and stub executables ────────────────────────────────────────

let home: string;
const daemonPids: number[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-binary-helper-"));
});

afterEach(async () => {
  for (const pid of daemonPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  await rm(home, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const server = createServer();
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  return port;
}

/**
 * `bin/versions/<version>/pi-studio`: a Node script that prints its version for `--version` and for
 * `__daemon` serves `/api/health` on the port in its JSON argument (or exits at once).
 */
async function stubVersion(version: string, mode: "serve" | "crash" = "serve"): Promise<void> {
  const dir = join(home, "bin/versions", version);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "pi-studio");
  await writeFile(
    file,
    `#!/usr/bin/env node
const [cmd, json] = process.argv.slice(2);
if (cmd === "--version") { console.log(${JSON.stringify(version)}); process.exit(0); }
if (cmd === "__daemon") {
  if (${JSON.stringify(mode)} === "crash") process.exit(1);
  const { port, home } = JSON.parse(json);
  require("node:fs").writeFileSync(home + "/daemon-" + ${JSON.stringify(version)} + ".pid", String(process.pid));
  require("node:http").createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", version: ${JSON.stringify(version)} }));
  }).listen(port, "127.0.0.1");
}
`,
  );
  await chmod(file, 0o755);
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"]);
  const exited = Promise.withResolvers<void>();
  child.on("exit", () => exited.resolve());
  await exited.promise;
  return child.pid ?? 0;
}

async function collectDaemonPids(): Promise<void> {
  for (const name of await readdir(home)) {
    if (name.startsWith("daemon-") && name.endsWith(".pid")) {
      daemonPids.push(Number(await readFile(join(home, name), "utf8")));
    }
  }
}

async function runReal(): Promise<{ result: HelperResult; params: HelperParams }> {
  const params: HelperParams = {
    oldPid: await deadPid(),
    target: "0.0.2",
    previous: "0.0.1",
    listen: `127.0.0.1:${await freePort()}`,
    home,
    packageName: "@av-pi-studio/cli",
  };
  const seams = realBinaryHelperSeams(params);
  const result = await runBinaryHelper(params, seams);
  await collectDaemonPids();
  return { result, params };
}

describe("the helper over real files and processes", () => {
  it("switches current to the target, starts it, removes the older versions and logs", async () => {
    await stubVersion("0.0.0");
    await stubVersion("0.0.1");
    await stubVersion("0.0.2");
    await symlink(join("versions", "0.0.1"), join(home, "bin/current"));

    const { result } = await runReal();
    expect(result.outcome).toBe("updated");
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.2"));
    expect((await readdir(join(home, "bin/versions"))).toSorted()).toEqual(["0.0.1", "0.0.2"]);
    expect(JSON.parse(await readFile(join(home, "update-result.json"), "utf8"))).toMatchObject({
      from: "0.0.1",
      to: "0.0.2",
      outcome: "updated",
    });
    const log = await readFile(join(home, "logs/update-restart.log"), "utf8");
    expect(log).toContain("update helper: 0.0.1 -> 0.0.2");
    expect(log).toContain("update updated");
  });

  it("switches back to the previous version when the new one does not start", async () => {
    await stubVersion("0.0.1");
    await stubVersion("0.0.2", "crash");
    await symlink(join("versions", "0.0.1"), join(home, "bin/current"));

    const { result, params } = await runReal();
    expect(result).toMatchObject({ from: "0.0.1", to: "0.0.2", outcome: "rolled_back" });
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.1"));
    // Both folders stay: nothing is removed after a rollback.
    expect((await readdir(join(home, "bin/versions"))).toSorted()).toEqual(["0.0.1", "0.0.2"]);
    expect(JSON.parse(await readFile(join(home, "update-result.json"), "utf8"))).toMatchObject({
      outcome: "rolled_back",
    });
    const health = await fetch(`http://${params.listen}/api/health`);
    expect(await health.json()).toMatchObject({ version: "0.0.1" });
  });
});
