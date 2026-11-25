import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger, silentLogger } from "../logging/logger.js";
import { connectTestClient, listeningPort, messageOf } from "../test-support/daemon-test-client.js";
import { fakeProcessHost } from "../test-support/fake-process-host.js";
import { recordingLogger, type LogLine } from "../test-support/recording-logger.js";
import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { runDaemon } from "./run.js";

/**
 * `runDaemon` is the process entry (`main.ts`, the CLI's detached starter): signals close the
 * daemon cleanly and exit, a self-update exits after its shutdown, an uncaught exception stops it
 * with exit 1, an unhandled rejection does not, and a daemon that loses the port exits 1 without
 * touching the winner's PID file. The process is a fake host, so nothing here signals or ends the
 * test process. The hanging, rejecting and stuck shutdowns are `run-signals.test.ts`.
 */

let handle: DaemonHandle | undefined;
let other: DaemonHandle | undefined;

afterEach(async () => {
  await handle?.close();
  await other?.close();
  handle = undefined;
  other = undefined;
  process.exitCode = undefined;
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-run-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-run-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { piHome, extensions: { autoSync: false } } }),
    "utf8",
  );
  return home;
}

describe("runDaemon", () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "%s closes the daemon cleanly (not listening, pid file removed), then exits 0",
    async (signal) => {
      const host = fakeProcessHost();
      const home = tempHome();
      handle = runDaemon({ host: "127.0.0.1", port: 0, home, logger: silentLogger() }, host);
      await listeningPort(handle.httpServer);
      const pidFile = join(home, "pi-studio.pid");
      expect(existsSync(pidFile)).toBe(true);

      host.handlers[signal]?.();
      expect(await host.exited).toBe(0);

      expect(handle.httpServer.listening).toBe(false);
      expect(existsSync(pidFile)).toBe(false);
      expect(host.exits).toEqual([0]);
    },
  );

  it("exits through the host after a self-update's shutdown", async () => {
    const host = fakeProcessHost();
    const home = tempHome();
    handle = runDaemon(
      {
        host: "127.0.0.1",
        port: 0,
        home,
        logger: silentLogger(),
        updateTestSeams: {
          service: {
            detectInstallKind: async () => "npm-global",
            fetchLatest: async () => "99.0.0",
            npmOnPath: async () => true,
            globalFolder: async () => "/fake/npm/root",
            canWriteGlobalFolder: async () => true,
            platform: "linux",
          },
          pipeline: {
            install: async () => undefined,
            updateExtensions: async () => undefined,
            spawnHelper: () => undefined,
            pause: async () => undefined,
          },
        },
      },
      host,
    );
    const client = await connectTestClient(await listeningPort(handle.httpServer));
    try {
      await client.rpc("daemon_update_check_request");
      expect(messageOf(await client.rpc("daemon_update_apply_request")).ok).toBe(true);
      expect(await host.exited).toBe(0);
      expect(handle.httpServer.listening).toBe(false);
    } finally {
      await client.close();
    }
  });
});

/** The names of the shutdown steps that ran to the end, in order. */
function stepsDone(lines: readonly LogLine[]): unknown[] {
  return lines
    .filter((l) => l.msg === "shutdown step done")
    .map((l) => (typeof l.obj === "object" && l.obj !== null && "step" in l.obj ? l.obj.step : ""));
}

async function health(port: number): Promise<number> {
  return (await fetch(`http://127.0.0.1:${port}/api/health`)).status;
}

describe("runDaemon: fatal errors", () => {
  it("an uncaught exception reaches the log file, shuts the daemon down and exits 1", async () => {
    const host = fakeProcessHost();
    const home = tempHome();
    const logDir = join(home, "logs-test");
    const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
    handle = runDaemon(
      {
        host: "127.0.0.1",
        port: 0,
        home,
        logger: createLogger({ level: "info", pretty: false, logDir, stdoutStream: sink }),
      },
      host,
    );
    await listeningPort(handle.httpServer);
    const pidFile = join(home, "pi-studio.pid");
    expect(existsSync(pidFile)).toBe(true);

    host.handlers.uncaughtException?.(new Error("boom"));
    expect(await host.exited).toBe(1);

    expect(host.exits).toEqual([1]);
    expect(handle.httpServer.listening).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
    // The exit waited for the log file: the fatal line is there.
    const fatal = readFileSync(join(logDir, "pi-studio.log"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line): unknown => JSON.parse(line))
      .find(
        (line) => typeof line === "object" && line !== null && "level" in line && line.level === 60,
      );
    expect(fatal).toMatchObject({
      err: "boom",
      msg: expect.stringContaining("uncaught exception"),
    });
  });

  it("an unhandled rejection is logged and the daemon keeps running and answering", async () => {
    const host = fakeProcessHost();
    const { logger, lines } = recordingLogger();
    handle = runDaemon({ host: "127.0.0.1", port: 0, home: tempHome(), logger }, host);
    const port = await listeningPort(handle.httpServer);

    host.handlers.unhandledRejection?.(new Error("stray"));

    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "error",
        msg: "unhandled rejection",
        obj: expect.objectContaining({ err: "stray" }),
      }),
    );
    expect(host.exits).toEqual([]);
    expect(handle.httpServer.listening).toBe(true);
    expect(await health(port)).toBe(200);
  });
});

describe("a second daemon on a taken port", () => {
  it("exits 1 after the same shutdown, leaving the first daemon's PID file and server alone", async () => {
    const home = tempHome();
    other = startDaemon({ host: "127.0.0.1", port: 0, home, logger: silentLogger() });
    const port = await listeningPort(other.httpServer);
    // The test process is both daemons: a sentinel makes "not overwritten, not removed" visible.
    const pidFile = join(home, "pi-studio.pid");
    writeFileSync(pidFile, "424242", "utf8");

    const host = fakeProcessHost();
    const { logger, lines } = recordingLogger();
    handle = runDaemon({ host: "127.0.0.1", port, home, logger }, host);
    expect(await host.exited).toBe(1);

    expect(host.exits).toEqual([1]);
    expect(readFileSync(pidFile, "utf8")).toBe("424242");
    expect(handle.httpServer.listening).toBe(false);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "error", msg: "cannot bind — address already in use" }),
    );
    expect(stepsDone(lines)).toEqual(
      expect.arrayContaining(["stop accepting", "agents", "sockets", "http", "pid file"]),
    );
    expect(other.httpServer.listening).toBe(true);
    expect(await health(port)).toBe(200);
  });
});
