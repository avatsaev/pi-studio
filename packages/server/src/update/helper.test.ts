import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import {
  compileHelperLogic,
  HELPER_LOGIC,
  HELPER_SCRIPT,
  spawnUpdateHelper,
  type HelperParams,
  type HelperResult,
  type HelperSeams,
  type HelperSpawn,
  type StartedDaemon,
} from "./helper.js";

const PARAMS: HelperParams = {
  oldPid: 4242,
  target: "0.0.11",
  previous: "0.0.10",
  listen: "0.0.0.0:6767",
  home: "/tmp/pi-studio-home",
  packageName: "@av-pi-studio/cli",
};

/** What a started daemon answers on `/api/health`: a version, or nothing. */
type Behaviour = { version: string | null; exitsAtOnce?: boolean };

interface World {
  seams: HelperSeams;
  log: string[];
  results: HelperResult[];
  started: Array<{ entry: string; stopped: boolean }>;
  entryRequests: string[];
  installs: string[];
  exitWaits: Array<{ pid: number; timeoutMs: number }>;
  clock: () => number;
}

/**
 * A fake machine for the helper: a virtual clock that only `sleep` moves, and a script of what each
 * started daemon answers (`behaviours[i]` for the i-th start; the last one repeats).
 */
function world(opts: {
  behaviours: Behaviour[];
  oldExits?: boolean;
  entry?: string | null | ((version: string) => string | null);
  installOk?: boolean;
  startThrows?: boolean;
}): World {
  let clock = 0;
  const log: string[] = [];
  const results: HelperResult[] = [];
  const started: World["started"] = [];
  const entryRequests: string[] = [];
  const installs: string[] = [];
  const exitWaits: World["exitWaits"] = [];
  let live: Behaviour | undefined;
  const seams: HelperSeams = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: (line) => log.push(line),
    waitForExit: async (pid, timeoutMs) => {
      exitWaits.push({ pid, timeoutMs });
      return opts.oldExits ?? true;
    },
    findEntry: async (version) => {
      entryRequests.push(version);
      const entry = opts.entry === undefined ? "/g/server/dist/daemon/main.js" : opts.entry;
      return typeof entry === "function" ? entry(version) : entry;
    },
    startDaemon: (entry): StartedDaemon => {
      if (opts.startThrows) throw new Error("spawn EACCES");
      const record = { entry, stopped: false };
      started.push(record);
      live = opts.behaviours[Math.min(started.length - 1, opts.behaviours.length - 1)];
      const behaviour = live;
      return {
        pid: 1000 + started.length,
        hasExited: () => behaviour?.exitsAtOnce === true,
        stop: async () => {
          record.stopped = true;
        },
      };
    },
    healthVersion: async () => live?.version ?? null,
    installPrevious: async (version) => {
      installs.push(version);
      return opts.installOk === false
        ? { ok: false, message: "npm error code ENOTFOUND" }
        : { ok: true, message: "" };
    },
    writeResult: (result) => {
      results.push(result);
    },
  };
  return { seams, log, results, started, entryRequests, installs, exitWaits, clock: () => clock };
}

const run = compileHelperLogic();

describe("helper logic", () => {
  it("the new version answers: updated, nothing rolled back", async () => {
    const w = world({ behaviours: [{ version: "0.0.11" }] });
    const result = await run(PARAMS, w.seams);
    expect(result).toEqual({ from: "0.0.10", to: "0.0.11", outcome: "updated", at: 0 });
    expect(w.results).toEqual([result]);
    expect(w.installs).toEqual([]);
    expect(w.started).toHaveLength(1);
    expect(w.exitWaits).toEqual([{ pid: 4242, timeoutMs: 30_000 }]);
    expect(w.entryRequests).toEqual(["0.0.11"]);
    expect(w.log[0]).toMatch(/0\.0\.10 -> 0\.0\.11, old pid 4242, listen 0\.0\.0\.0:6767/);
  });

  it("a daemon that answers on the second try is updated; the first one was stopped", async () => {
    const w = world({ behaviours: [{ version: null }, { version: "0.0.11" }] });
    const result = await run(PARAMS, w.seams);
    expect(result.outcome).toBe("updated");
    expect(w.started.map((s) => s.stopped)).toEqual([true, false]);
    expect(w.clock()).toBeGreaterThanOrEqual(6_000);
  });

  it("a daemon that answers with the wrong version never counts as started", async () => {
    const w = world({ behaviours: [{ version: "0.0.10" }, { version: "0.0.11" }] });
    expect((await run(PARAMS, w.seams)).outcome).toBe("updated");
    expect(w.started).toHaveLength(2);
  });

  it("never answers in three tries: the previous version is installed and started: rolled_back", async () => {
    const w = world({
      behaviours: [{ version: null }, { version: null }, { version: null }, { version: "0.0.10" }],
    });
    const result = await run(PARAMS, w.seams);
    expect(result).toMatchObject({ from: "0.0.10", to: "0.0.11", outcome: "rolled_back" });
    expect(result.message).toMatch(/0\.0\.11 did not start.*back on 0\.0\.10/);
    expect(w.installs).toEqual(["0.0.10"]);
    expect(w.started).toHaveLength(4);
    expect(w.started.map((s) => s.stopped)).toEqual([true, true, true, false]);
    expect(w.entryRequests).toEqual(["0.0.11", "0.0.11", "0.0.11", "0.0.10"]);
    expect(w.results).toHaveLength(1);
  });

  it("the previous version does not start either: failed, with the log line", async () => {
    const w = world({ behaviours: [{ version: null }] });
    const result = await run(PARAMS, w.seams);
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("pi-studio daemon start");
    expect(w.installs).toEqual(["0.0.10"]);
    expect(w.started).toHaveLength(6);
    expect(w.log.at(-1)).toContain("pi-studio daemon start");
    expect(w.results).toEqual([result]);
  });

  it("a failed rollback install is reported in the message and the start is still tried", async () => {
    const w = world({ behaviours: [{ version: null }], installOk: false });
    const result = await run(PARAMS, w.seams);
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("rollback install failed: npm error code ENOTFOUND");
    expect(w.started).toHaveLength(6);
  });

  it("an entry that is not found counts as a try and starts nothing", async () => {
    const w = world({ behaviours: [{ version: "0.0.11" }], entry: null });
    const result = await run(PARAMS, w.seams);
    expect(result.outcome).toBe("failed");
    expect(w.started).toHaveLength(0);
    expect(w.entryRequests).toHaveLength(6);
  });

  it("a start that throws counts as a try", async () => {
    const w = world({ behaviours: [{ version: "0.0.11" }], startThrows: true });
    expect((await run(PARAMS, w.seams)).outcome).toBe("failed");
    expect(w.log.some((l) => l.includes("cannot start the daemon: spawn EACCES"))).toBe(true);
  });

  it("an old daemon that does not exit in 30 s is logged and the helper goes on", async () => {
    const w = world({ behaviours: [{ version: "0.0.11" }], oldExits: false });
    expect((await run(PARAMS, w.seams)).outcome).toBe("updated");
    expect(w.log.some((l) => l.includes("still running after 30 s"))).toBe(true);
  });

  it("a daemon that exits at once ends its try without waiting for the full 6 s", async () => {
    const w = world({ behaviours: [{ version: null, exitsAtOnce: true }, { version: "0.0.11" }] });
    expect((await run(PARAMS, w.seams)).outcome).toBe("updated");
    expect(w.clock()).toBeLessThan(6_000);
  });

  it("the health URL targets loopback for a wildcard bind and brackets IPv6", () => {
    const healthUrl = new Function(`${HELPER_LOGIC}\nreturn healthUrl;`)() as (l: string) => string;
    expect(healthUrl("0.0.0.0:6767")).toBe("http://127.0.0.1:6767/api/health");
    expect(healthUrl("127.0.0.1:7000")).toBe("http://127.0.0.1:7000/api/health");
    expect(healthUrl("192.168.1.5:6767")).toBe("http://192.168.1.5:6767/api/health");
    expect(healthUrl("::1:6767")).toBe("http://[::1]:6767/api/health");
  });
});

describe("helper script text", () => {
  it("is self-contained: no import, and every require is a node: built-in", () => {
    expect(HELPER_SCRIPT).not.toMatch(/\bimport\b/);
    const requires = [...HELPER_SCRIPT.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(
      (m) => m[1],
    );
    expect(requires.length).toBeGreaterThan(0);
    for (const specifier of requires) expect(specifier).toMatch(/^node:/);
    expect(HELPER_SCRIPT).not.toMatch(/\brequire\(\s*[^"'\s]/);
  });

  it("is valid JavaScript", () => {
    expect(() => new Script(HELPER_SCRIPT)).not.toThrow();
  });
});

describe("spawnUpdateHelper", () => {
  it("starts node -e with the script and the params, detached, carrying the environment", () => {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    let unrefs = 0;
    const fake: HelperSpawn = (command, args, options) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      return { pid: 7, unref: () => void unrefs++, on: () => ({}) as never };
    };
    spawnUpdateHelper(PARAMS, { PATH: "/bin", PI_STUDIO_PASSWORD: "p" }, fake);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual(["-e", HELPER_SCRIPT, JSON.stringify(PARAMS)]);
    expect(calls[0]?.options).toMatchObject({
      detached: true,
      stdio: "ignore",
      env: {
        PATH: "/bin",
        PI_STUDIO_PASSWORD: "p",
        PI_STUDIO_LISTEN: "0.0.0.0:6767",
        PI_STUDIO_HOME: "/tmp/pi-studio-home",
      },
    });
    expect(unrefs).toBe(1);
  });

  it("throws when the process has no pid", () => {
    expect(() => spawnUpdateHelper(PARAMS, {}, noPidSpawn)).toThrow(/failed to spawn/);
  });
});

const noPidSpawn: HelperSpawn = () => ({
  pid: undefined,
  unref: () => {},
  on: () => ({}) as never,
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * The real script, run as `node -e` in a temp home against a fake `npm` and a fake daemon entry on
 * a free port: proves the real seams (entry lookup in an npm root, the carried environment, the
 * health check, the result and log files) work. Nothing here touches a real daemon, npm or home.
 */
describe.skipIf(process.platform === "win32")("helper script, run for real against fakes", () => {
  const pidFiles: string[] = [];

  afterEach(() => {
    for (const file of pidFiles.splice(0)) {
      try {
        process.kill(Number(readFileSync(file, "utf8")), "SIGTERM");
      } catch {
        /* never started, or already gone */
      }
    }
  });

  it("finds the entry under the npm root, starts it on the carried address, writes `updated`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-studio-helper-real-"));
    const home = join(dir, "home");
    const root = join(dir, "npm-root");
    const bin = join(dir, "bin");
    const serverDir = join(root, "@av-pi-studio", "server");
    mkdirSync(join(serverDir, "dist", "daemon"), { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(serverDir, "package.json"), JSON.stringify({ version: "9.9.9" }));
    writeFileSync(
      join(serverDir, "dist", "daemon", "main.js"),
      [
        'const http = require("node:http");',
        'const fs = require("node:fs");',
        'const port = Number(process.env.PI_STUDIO_LISTEN.split(":").pop());',
        'http.createServer((q, r) => r.end(JSON.stringify({ status: "ok", version: "9.9.9" })))',
        '  .listen(port, "127.0.0.1");',
        'fs.writeFileSync(process.env.PI_STUDIO_HOME + "/fake-daemon.pid", String(process.pid));',
        'process.on("SIGTERM", () => process.exit(0));',
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "npm"),
      '#!/bin/sh\n[ "$1" = "root" ] && echo "$FAKE_NPM_ROOT"\nexit 0\n',
    );
    chmodSync(join(bin, "npm"), 0o755);
    pidFiles.push(join(home, "fake-daemon.pid"));

    // A pid that is certainly gone: the helper's first wait returns at once.
    const gone = spawn(process.execPath, ["-e", ""]);
    await new Promise((resolve) => gone.on("exit", resolve));

    const port = await freePort();
    const params: HelperParams = {
      oldPid: gone.pid as number,
      target: "9.9.9",
      previous: "9.9.8",
      listen: `0.0.0.0:${port}`,
      home,
      packageName: "@av-pi-studio/cli",
    };
    const helper = spawn(process.execPath, ["-e", HELPER_SCRIPT, JSON.stringify(params)], {
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_NPM_ROOT: root,
        PI_STUDIO_LISTEN: params.listen,
        PI_STUDIO_HOME: home,
      },
    });
    const code = await new Promise((resolve) => helper.on("exit", resolve));
    expect(code).toBe(0);

    const result = JSON.parse(
      readFileSync(join(home, "update-result.json"), "utf8"),
    ) as HelperResult;
    expect(result).toMatchObject({ from: "9.9.8", to: "9.9.9", outcome: "updated" });
    const log = readFileSync(join(home, "logs", "update-restart.log"), "utf8");
    expect(log).toContain("answers with version 9.9.9");
    expect(log).toContain("update updated");
  }, 30_000);
});
