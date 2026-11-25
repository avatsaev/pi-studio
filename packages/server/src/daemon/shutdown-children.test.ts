import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectTestClient, type TestClient } from "../test-support/daemon-test-client.js";
import {
  commandOf,
  descendantsOf,
  isAlive,
  killQuietly,
  readPid,
} from "../test-support/process-probe.js";
import { SHUTDOWN_DEADLINE_MS } from "./shutdown.js";

/**
 * What outlives a stopped daemon, checked on a real daemon process (not an in-process `startDaemon`,
 * whose host is the test runner): it runs `daemon/main.ts` under `vite-node` (which ships with
 * vitest), gets an install running and a terminal open, receives SIGTERM, and must exit by itself
 * within the shutdown deadline with no process of its tree left.
 *
 * The install is a stand-in: the bundled `pi install` runs for real, but the `npm` it calls is a
 * script first on PATH that records its pid and sleeps, so the test needs no network and the install
 * is still running when the signal arrives. The terminal's shell ignores SIGTERM and SIGHUP, so only
 * the daemon's SIGKILL escalation can end it.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const VITE_NODE = join(
  dirname(dirname(createRequire(import.meta.url).resolve("vite-node"))),
  "vite-node.mjs",
);

/** How long the daemon gets to start: `vite-node` transforms the whole server on the way. */
const START_TIMEOUT_MS = 60_000;

const roots: string[] = [];
let daemon: ChildProcess | undefined;
let client: TestClient | undefined;
const leftovers: number[] = [];

afterEach(async () => {
  client?.ws.terminate();
  client = undefined;
  if (daemon?.pid !== undefined) leftovers.push(...descendantsOf(daemon.pid));
  daemon?.kill("SIGKILL");
  daemon = undefined;
  for (const pid of leftovers.splice(0)) killQuietly(pid);
  for (const root of roots.splice(0)) {
    killProcessesOf(root);
    await rm(root, { recursive: true, force: true });
  }
});

/** SIGKILLs every process whose command line names `root` (the stand-in scripts live there), and what they started. */
function killProcessesOf(root: string): void {
  const table = execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" });
  for (const line of table.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match?.[2]?.includes(root) || Number(match[1]) === process.pid) continue;
    for (const pid of [...descendantsOf(Number(match[1])), Number(match[1])]) killQuietly(pid);
  }
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const server = createServer();
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function script(path: string, body: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

describe("a daemon process stopped by SIGTERM", () => {
  it("exits within the shutdown deadline with an install running and a terminal open, and leaves no process behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-studio-shutdown-children-"));
    roots.push(root);
    const bin = join(root, "bin");
    await mkdir(bin);
    await mkdir(join(root, "home"));
    const npmPids = join(root, "npm.pids");
    const shellPid = join(root, "shell.pid");
    // `pi install` calls `npm install`; this one records its pid and sleeps, as a slow install would.
    // Any other npm call (the daemon's own update probes) fails at once, as an offline npm does.
    await script(
      join(bin, "npm"),
      `if [ "$1" = install ]; then\n  echo $$ >> "${npmPids}"\n  sleep 3000\nfi\nexit 1`,
    );
    // A shell that ignores SIGTERM and SIGHUP.
    await script(
      join(bin, "stubborn-shell"),
      `trap "" TERM HUP\necho $$ > "${shellPid}"\nwhile :; do sleep 1; done`,
    );

    const port = await freePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PI_STUDIO_HOME: join(root, "home"),
      PI_STUDIO_LISTEN: `127.0.0.1:${port}`,
      PI_STUDIO_UPDATE_AUTOCHECK: "false",
    };
    delete env.PI_STUDIO_PASSWORD;
    delete env.PI_CODING_AGENT_DIR;
    // The working directory is where the daemon finds the bundled pi (`node_modules` above it).
    const child = spawn(process.execPath, [VITE_NODE, MAIN], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    daemon = child;
    let output = "";
    const listening = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<{ code: number | null; signal: string | null }>();
    const onOutput = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.includes("pi-studio daemon listening")) listening.resolve();
    };
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.on("exit", (code, signal) => {
      listening.reject(new Error(`the daemon exited before listening:\n${output}`));
      exited.resolve({ code, signal });
    });
    await listening.promise; // rejects at once if the daemon exits first
    if (child.pid === undefined) throw new Error("the daemon has no pid");

    // The bootstrap's extensions sync starts a `pi install`, which is now stuck in the stand-in.
    await vi.waitFor(async () => expect(await readFile(npmPids, "utf8")).not.toBe(""), {
      timeout: START_TIMEOUT_MS,
      interval: 50,
    });
    // The "listening" line is logged right after `listen()` is called, a moment before the bind.
    client = await vi.waitFor(() => connectTestClient(port), { timeout: 10_000, interval: 50 });
    const created = await client.rpc("create_terminal_request", {
      workspaceId: "w1",
      cwd: root,
      shell: join(bin, "stubborn-shell"),
    });
    expect(created.terminal).toBeDefined();
    leftovers.push(await readPid(shellPid));
    const tree = descendantsOf(child.pid);
    expect(tree).toContain(leftovers[0]); // the terminal's shell
    expect(tree.length).toBeGreaterThanOrEqual(4); // pi, the stand-in npm, its sleep, the shell, …
    leftovers.push(...tree);

    const signalled = Date.now();
    child.kill("SIGTERM");
    const result = await exited.promise;
    const tookMs = Date.now() - signalled;

    expect(result, output).toEqual({ code: 0, signal: null });
    expect(tookMs).toBeLessThan(SHUTDOWN_DEADLINE_MS);
    expect(output).not.toContain("shutdown step still running at the deadline");
    expect(output).not.toContain("shutdown step skipped");
    expect(tree.filter(isAlive).map(commandOf)).toEqual([]);
  }, 120_000);
});
