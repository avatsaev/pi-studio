import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { fakeProcessHost } from "../test-support/fake-process-host.js";
import { recordingLogger, type LogLine } from "../test-support/recording-logger.js";
import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { HARD_KILL_GRACE_MS, runDaemon } from "./run.js";
import { SHUTDOWN_DEADLINE_MS } from "./shutdown.js";

/**
 * How `runDaemon` ends the process when the shutdown misbehaves: it hangs (a second signal, the
 * hard-kill timer), it rejects, a fatal error arrives while a signal's shutdown is running, the
 * daemon fails before it exists. The daemon is a fake whose `close` the test controls; a real one
 * cannot hang past its own deadline. Fake timers, a fake host: nothing here ends the test process.
 */
vi.mock("./bootstrap.js", () => ({ startDaemon: vi.fn() }));

const HARD_KILL_MS = SHUTDOWN_DEADLINE_MS + HARD_KILL_GRACE_MS;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(startDaemon).mockReset();
});

/** Makes `startDaemon` return a daemon whose `close` is `close`. */
function daemonClosing(close: () => Promise<void>): { lines: LogLine[] } {
  const { logger, lines } = recordingLogger();
  const daemon: DaemonHandle = {
    httpServer: createServer(),
    serverId: "test-server",
    home: "/fake/home",
    provider: "pi",
    logger,
    listen: { host: "127.0.0.1", port: 1 },
    close,
  };
  vi.mocked(startDaemon).mockReturnValue(daemon);
  return { lines };
}

describe("runDaemon: a shutdown that misbehaves", () => {
  it("a second signal during a hanging shutdown exits 1 at once", () => {
    daemonClosing(() => Promise.withResolvers<void>().promise);
    const host = fakeProcessHost();
    runDaemon({}, host);

    host.handlers.SIGTERM?.();
    expect(host.exits).toEqual([]);
    host.handlers.SIGINT?.();

    expect(host.exits).toEqual([1]);
  });

  it("a shutdown that rejects still exits, with 1", async () => {
    const { lines } = daemonClosing(() => Promise.reject(new Error("close failed")));
    const host = fakeProcessHost();
    runDaemon({}, host);

    host.handlers.SIGTERM?.();

    expect(await host.exited).toBe(1);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "error", msg: "shutdown failed" }),
    );
  });

  it("a shutdown that hangs is ended by the timer, 2 s after the deadline", async () => {
    daemonClosing(() => Promise.withResolvers<void>().promise);
    const host = fakeProcessHost();
    runDaemon({}, host);

    host.handlers.SIGTERM?.();
    await vi.advanceTimersByTimeAsync(HARD_KILL_MS - 1);
    expect(host.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(host.exits).toEqual([1]);
  });

  it("a shutdown that finishes in time cancels the timer", async () => {
    const closed = Promise.withResolvers<void>();
    daemonClosing(() => closed.promise);
    const host = fakeProcessHost();
    runDaemon({}, host);

    host.handlers.SIGTERM?.();
    await vi.advanceTimersByTimeAsync(HARD_KILL_MS - 1);
    closed.resolve();
    await vi.advanceTimersByTimeAsync(HARD_KILL_MS);

    expect(host.exits).toEqual([0]);
  });

  it("an uncaught exception during a signal's shutdown turns its exit code into 1", async () => {
    const closed = Promise.withResolvers<void>();
    const { lines } = daemonClosing(() => closed.promise);
    const host = fakeProcessHost();
    runDaemon({}, host);

    host.handlers.SIGTERM?.();
    host.handlers.uncaughtException?.(new Error("boom"));
    expect(host.exits).toEqual([]);
    closed.resolve();

    expect(await host.exited).toBe(1);
    expect(host.exits).toEqual([1]);
    expect(lines).toContainEqual(expect.objectContaining({ level: "fatal" }));
  });
});

describe("runDaemon: a daemon that fails to start", () => {
  it("exits 1 through the host at once: there is nothing to shut down", () => {
    const host = fakeProcessHost();
    vi.mocked(startDaemon).mockImplementation((opts) => {
      const error = new Error("Invalid listen address");
      opts.onFatalError?.(error);
      throw error;
    });

    expect(() => runDaemon({ logger: silentLogger() }, host)).toThrow(/Invalid listen address/);

    expect(host.exits).toEqual([1]);
    expect(host.handlers).toEqual({});
  });
});
