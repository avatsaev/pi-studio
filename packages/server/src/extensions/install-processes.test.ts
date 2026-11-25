import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordingLogger } from "../test-support/recording-logger.js";
import { isAlive, killQuietly, readPid } from "../test-support/process-probe.js";
import { InstallProcesses } from "./install-processes.js";

/**
 * The production install seam against real children: faking timers or signals cannot show that a
 * process tree is really gone, so these start `sh` and `sleep` and probe their pids. Every pid a
 * test learns is SIGKILLed in `afterEach`, so a failing assertion leaves nothing running.
 */

const ENV = { PATH: process.env.PATH ?? "" };

const dirs: string[] = [];
const leftovers: number[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-install-processes-"));
  dirs.push(dir);
  return dir;
}

/** Waits for `file` to hold a pid and remembers it for cleanup. */
async function trackedPid(file: string): Promise<number> {
  const pid = await readPid(file);
  leftovers.push(pid);
  return pid;
}

/** A shell that records its pid in `pidFile`, then becomes `sleep 60`. */
function sleepCommand(pidFile: string): string[] {
  return ["sh", "-c", 'echo $$ > "$1"; exec sleep 60', "sh", pidFile];
}

afterEach(async () => {
  for (const pid of leftovers.splice(0)) killQuietly(pid);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// The seam's own timeout enforcement drives a real `setTimeout` against a real OS process tree
// (`tree-kill`); faking timers can't simulate an actual hung child or a real kill signal reaching
// it, so the first test genuinely needs the platform clock — kept to a millisecond-scale timeout
// so it stays fast.
describe("InstallProcesses.spawn — the production seam", () => {
  it("kills a hung process tree on timeout (real short-lived child, millisecond-scale timeout)", async () => {
    const result = await new InstallProcesses().spawn({
      command: [process.execPath, "-e", "setInterval(() => {}, 1000);"],
      env: ENV,
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("resolves with the exit code and captured stderr for a normal short-lived child", async () => {
    const result = await new InstallProcesses().spawn({
      command: [process.execPath, "-e", "process.stderr.write('hi'); process.exit(0);"],
      env: ENV,
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ exitCode: 0, stderr: "hi" });
  });

  it("rejects when the binary cannot be spawned at all", async () => {
    await expect(
      new InstallProcesses().spawn({
        command: ["definitely-not-a-real-binary-xyz-123"],
        env: {},
        timeoutMs: 5000,
      }),
    ).rejects.toThrow();
  });
});

describe("InstallProcesses.stop", () => {
  it("ends a running child (sleep 60) and its install settles", async () => {
    const dir = await tempDir();
    const processes = new InstallProcesses();
    const running = processes.spawn({
      command: sleepCommand(join(dir, "pid")),
      env: ENV,
      timeoutMs: 60_000,
    });
    const pid = await trackedPid(join(dir, "pid"));

    await processes.stop();

    expect(isAlive(pid)).toBe(false);
    await expect(running).resolves.toMatchObject({ exitCode: null, timedOut: false });
  });

  it("ends the whole process tree, not only the direct child", async () => {
    const dir = await tempDir();
    const processes = new InstallProcesses();
    // A shell that starts a `sleep` of its own and waits for it, as `npm` does with a build step.
    void processes.spawn({
      command: [
        "sh",
        "-c",
        'echo $$ > "$1"; sleep 60 & echo $! > "$2"; wait',
        "sh",
        join(dir, "shell.pid"),
        join(dir, "sleep.pid"),
      ],
      env: ENV,
      timeoutMs: 60_000,
    });
    const shell = await trackedPid(join(dir, "shell.pid"));
    const grandchild = await trackedPid(join(dir, "sleep.pid"));

    await processes.stop();

    expect(isAlive(shell)).toBe(false);
    expect(isAlive(grandchild)).toBe(false);
  });

  it("sends SIGKILL to a child that ignores SIGTERM, and logs it", async () => {
    const dir = await tempDir();
    const { logger, lines } = recordingLogger();
    const processes = new InstallProcesses({ logger, graceMs: 200 });
    void processes.spawn({
      // The shell and every `sleep` it starts inherit the ignored SIGTERM.
      command: [
        "sh",
        "-c",
        'trap "" TERM; echo $$ > "$1"; while :; do sleep 1; done',
        "sh",
        join(dir, "pid"),
      ],
      env: ENV,
      timeoutMs: 60_000,
    });
    const pid = await trackedPid(join(dir, "pid"));

    await processes.stop();

    expect(isAlive(pid)).toBe(false);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", msg: "an install process ignored SIGTERM: killed" }),
    );
  });

  it("refuses to start a child afterwards", async () => {
    const dir = await tempDir();
    const processes = new InstallProcesses();
    await processes.stop();

    await expect(
      processes.spawn({ command: sleepCommand(join(dir, "pid")), env: ENV, timeoutMs: 60_000 }),
    ).rejects.toThrow("the daemon is shutting down");
    expect(existsSync(join(dir, "pid"))).toBe(false); // nothing was started
  });

  it("leaves a process it did not start alone (the update helper is spawned outside the seam)", async () => {
    const processes = new InstallProcesses();
    const helper = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    helper.unref();
    const pid = helper.pid;
    if (pid === undefined) throw new Error("the stand-in helper did not start");
    leftovers.push(pid);

    await processes.stop();

    expect(isAlive(pid)).toBe(true);
  });
});
