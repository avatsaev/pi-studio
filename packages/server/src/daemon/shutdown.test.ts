import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { MockAgentSession } from "../agent/providers/mock/mock-provider.js";
import { FileWatchService } from "../files/file-watch-service.js";
import { closeHttpServer } from "../http/http-server.js";
import { silentLogger, type Logger } from "../logging/logger.js";
import { loadAllAgents } from "../persistence/entity-stores.js";
import { TerminalManager } from "../terminal/terminal-manager.js";
import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { startDevDaemon } from "./dev-bootstrap.js";
import { runShutdown, SHUTDOWN_DEADLINE_MS } from "./shutdown.js";

/**
 * Shutdown of the production and dev daemons (features/self-update.md § Shutdown): the runner
 * (`runShutdown`: isolated steps, one deadline, an `always` step), and the order and effects of the
 * steps each daemon lists through it — every live agent session is closed, terminals are killed,
 * requests and connections are refused from the start, `pi-studio.pid` is removed when it still
 * names this process. Every daemon binds port 0 under a temp `PI_STUDIO_HOME`.
 */

let handle: DaemonHandle | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await handle?.close();
  handle = undefined;
  vi.restoreAllMocks();
});

interface LogLine {
  level: string;
  msg: string;
  obj?: unknown;
}

/** A `Logger` that records every line; children log into the same list. */
function recordingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record =
    (level: string) =>
    (first: unknown, second?: string): void => {
      lines.push(
        typeof first === "string"
          ? { level, msg: first }
          : { level, msg: second ?? "", obj: first },
      );
    };
  const logger: Logger = {
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: () => logger,
  };
  return { logger, lines };
}

/** The `step` a runner line names. */
function stepOf(line: LogLine): string | undefined {
  const { obj } = line;
  return typeof obj === "object" && obj !== null && "step" in obj && typeof obj.step === "string"
    ? obj.step
    : undefined;
}

/** The steps that ran to the end, in order. */
function doneSteps(lines: readonly LogLine[]): Array<string | undefined> {
  return lines.filter((l) => l.msg === "shutdown step done").map(stepOf);
}

/** Pairs of `[message, step]` for every line at `level`. */
function stepLines(lines: readonly LogLine[], level: string): Array<[string, string | undefined]> {
  return lines.filter((l) => l.level === level).map((l) => [l.msg, stepOf(l)]);
}

/** A promise that never settles: a step that never returns. */
function never(): Promise<void> {
  return Promise.withResolvers<void>().promise;
}

describe("runShutdown", () => {
  it("runs the steps in order and waits for an async one", async () => {
    const { logger, lines } = recordingLogger();
    const order: string[] = [];
    await runShutdown(
      [
        {
          name: "slow",
          run: async () => {
            await Promise.resolve();
            order.push("slow");
          },
        },
        {
          name: "sync",
          run: () => {
            order.push("sync");
          },
        },
      ],
      logger,
    );
    expect(order).toEqual(["slow", "sync"]);
    expect(doneSteps(lines)).toEqual(["slow", "sync"]);
  });

  it("logs a step that throws or rejects by name, and the later steps still run", async () => {
    const { logger, lines } = recordingLogger();
    const order: string[] = [];
    await expect(
      runShutdown(
        [
          {
            name: "throws",
            run: () => {
              throw new Error("boom");
            },
          },
          { name: "rejects", run: () => Promise.reject(new Error("nope")) },
          {
            name: "after",
            run: () => {
              order.push("after");
            },
          },
        ],
        logger,
      ),
    ).resolves.toBeUndefined();
    expect(order).toEqual(["after"]);
    expect(stepLines(lines, "error")).toEqual([
      ["shutdown step failed", "throws"],
      ["shutdown step failed", "rejects"],
    ]);
    expect(lines.filter((l) => l.level === "error").map((l) => l.obj)).toEqual([
      { step: "throws", err: "boom" },
      { step: "rejects", err: "nope" },
    ]);
  });

  it("gives up on a step that never returns at the deadline: later steps are skipped, an always step runs", async () => {
    vi.useFakeTimers();
    const { logger, lines } = recordingLogger();
    const order: string[] = [];
    let finished = false;
    const done = runShutdown(
      [
        {
          name: "first",
          run: () => {
            order.push("first");
          },
        },
        { name: "stuck", run: never },
        {
          name: "later",
          run: () => {
            order.push("later");
          },
        },
        {
          name: "pid file",
          run: () => {
            order.push("pid file");
          },
          always: true,
        },
      ],
      logger,
    ).then(() => {
      finished = true;
    });

    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(finished).toBe(false);
    expect(order).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(order).toEqual(["first", "pid file"]);
    expect(stepLines(lines, "warn")).toEqual([
      ["shutdown step still running at the deadline: abandoned", "stuck"],
      ["shutdown step skipped: the deadline passed", "later"],
    ]);
    expect(doneSteps(lines)).toEqual(["first"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs an always step that was reached before the deadline normally", async () => {
    vi.useFakeTimers();
    const { logger, lines } = recordingLogger();
    const order: string[] = [];
    await runShutdown(
      [
        {
          name: "pid file",
          run: () => {
            order.push("pid file");
          },
          always: true,
        },
      ],
      logger,
    );
    expect(order).toEqual(["pid file"]);
    expect(doneSteps(lines)).toEqual(["pid file"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

interface Client {
  rpc: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** A top-level `ping`; resolves with the `pong`. */
  ping: () => Promise<Record<string, unknown>>;
  close: () => void;
}

function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("listening", () => resolve((server.address() as AddressInfo).port));
  server.once("error", reject);
  return promise;
}

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (msg: Record<string, unknown>) => void>();
  const ready = Promise.withResolvers<void>();
  ws.once("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        clientId: "shutdown-test",
        clientType: "cli",
        protocolVersion: 1,
      }),
    );
  });
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) return;
    const env = JSON.parse(data.toString("utf8"));
    if (env.type === "status") ready.resolve();
    if (env.type === "pong") pending.get(env.requestId)?.(env);
    if (env.type === "session" && env.message?.requestId) {
      pending.get(env.message.requestId)?.(env.message);
    }
  });
  ws.once("error", ready.reject);
  await ready.promise;

  const request = (frame: (requestId: string) => unknown, label: string) => {
    const requestId = `req-${Math.random().toString(36).slice(2)}`;
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    const timer = setTimeout(() => reject(new Error(`rpc timeout: ${label}`)), 4000);
    pending.set(requestId, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify(frame(requestId)));
    return promise;
  };
  return {
    rpc: (message) =>
      request(
        (requestId) => ({ type: "session", message: { ...message, requestId } }),
        String(message.type),
      ),
    ping: () => request((requestId) => ({ type: "ping", requestId }), "ping"),
    close: () => ws.close(),
  };
}

/** The status code the daemon answers an upgrade with (101 when it accepts). */
function upgradeStatus(port: number): Promise<number> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const { promise, resolve } = Promise.withResolvers<number>();
  ws.once("open", () => {
    ws.close();
    resolve(101);
  });
  ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
  ws.once("error", () => undefined);
  return promise;
}

/** Creates a mock agent and sends it a prompt: the session is spawned by the first prompt. */
async function spawnMockAgent(client: Client, cwd: string): Promise<void> {
  const created = await client.rpc({
    type: "create_agent_request",
    config: { provider: "mock", cwd },
  });
  expect(created.type).toBe("create_agent_response");
  const { payload } = created;
  if (typeof payload !== "object" || payload === null || !("agentId" in payload)) {
    throw new Error("create_agent_response carries no agentId");
  }
  await client.rpc({ type: "send_agent_prompt", agentId: payload.agentId, prompt: "hello" });
}

async function boot(
  options: { logger?: Logger; relay?: boolean } = {},
): Promise<{ handle: DaemonHandle; port: number; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-shutdown-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-shutdown-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      daemon: {
        piHome,
        extensions: { autoSync: false },
        // A relay nothing listens on: the transport is wired and retries, which is all the order needs.
        ...(options.relay
          ? { relay: { enabled: true, endpoint: "127.0.0.1:1", useTls: false } }
          : {}),
      },
    }),
    "utf8",
  );
  const h = startDaemon({
    host: "127.0.0.1",
    port: 0,
    home,
    logger: options.logger ?? silentLogger(),
  });
  return { handle: h, port: await listeningPort(h.httpServer), home };
}

/** A running daemon as the refusal scenario sees it. */
interface Rig {
  port: number;
  cwd: string;
  close: () => Promise<void>;
  agentCount: () => Promise<number>;
}

/**
 * Shutdown while an agent is still closing: a new connection gets 503, a request on an open one
 * gets `shutting_down` and creates nothing, a ping is still answered.
 */
async function expectRefusalWhileAgentsClose(rig: Rig): Promise<void> {
  const client = await connect(rig.port);
  await spawnMockAgent(client, rig.cwd);
  expect(await rig.agentCount()).toBe(1);

  const closeStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(MockAgentSession.prototype, "close").mockImplementation(async () => {
    closeStarted.resolve();
    await release.promise;
  });
  const closing = rig.close();
  await closeStarted.promise;

  expect(await upgradeStatus(rig.port)).toBe(503);
  const refused = await client.rpc({
    type: "create_agent_request",
    config: { provider: "mock", cwd: rig.cwd },
  });
  expect(refused).toMatchObject({ type: "rpc_error", code: "shutting_down" });
  expect((await client.ping()).type).toBe("pong");

  release.resolve();
  await closing;
  expect(await rig.agentCount()).toBe(1);
  client.close();
}

describe("production daemon shutdown", () => {
  it("closes the live agent session before the terminals and removes the PID file", async () => {
    const booted = await boot();
    handle = booted.handle;
    const pidFile = join(booted.home, "pi-studio.pid");
    expect(readFileSync(pidFile, "utf8")).toBe(String(process.pid));

    const order: string[] = [];
    const sessionClose = vi
      .spyOn(MockAgentSession.prototype, "close")
      .mockImplementation(function (this: MockAgentSession) {
        order.push("agent");
        return Promise.resolve();
      });
    const terminalsKill = vi
      .spyOn(TerminalManager.prototype, "killAll")
      .mockImplementation(() => void order.push("terminals"));

    const client = await connect(booted.port);
    await spawnMockAgent(client, booted.home);
    const terminal = await client.rpc({ type: "create_terminal_request", cwd: booted.home });
    expect(terminal.type).toBe("create_terminal_response");

    await booted.handle.close();

    expect(sessionClose).toHaveBeenCalledTimes(1);
    expect(terminalsKill).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["agent", "terminals"]);
    expect(existsSync(pidFile)).toBe(false);
    client.close();
  }, 15000);

  it("closes a session with the real mock provider and is safe to close twice", async () => {
    const booted = await boot();
    handle = booted.handle;
    const sessionClose = vi.spyOn(MockAgentSession.prototype, "close");

    const client = await connect(booted.port);
    await spawnMockAgent(client, booted.home);

    const first = booted.handle.close();
    const second = booted.handle.close();
    expect(second).toBe(first);
    await first;
    await booted.handle.close();

    expect(sessionClose).toHaveBeenCalledTimes(1);
    const [session] = sessionClose.mock.contexts;
    if (!(session instanceof MockAgentSession)) throw new Error("close ran on a foreign session");
    expect(session.isClosed()).toBe(true);
    expect(existsSync(join(booted.home, "pi-studio.pid"))).toBe(false);
    client.close();
  }, 15000);

  it("leaves a PID file that names another process alone", async () => {
    const booted = await boot();
    handle = booted.handle;
    const pidFile = join(booted.home, "pi-studio.pid");
    writeFileSync(pidFile, String(process.pid + 1), "utf8");

    await booted.handle.close();

    expect(readFileSync(pidFile, "utf8")).toBe(String(process.pid + 1));
  });

  it("does not fail when the PID file is already gone", async () => {
    const booted = await boot();
    handle = booted.handle;
    rmSync(join(booted.home, "pi-studio.pid"));
    await expect(booted.handle.close()).resolves.toBeUndefined();
  });

  it("runs the later steps and removes the PID file when a step throws", async () => {
    const { logger, lines } = recordingLogger();
    const booted = await boot({ logger });
    handle = booted.handle;
    vi.spyOn(TerminalManager.prototype, "killAll").mockImplementation(() => {
      throw new Error("pty refuses to die");
    });
    const fileWatchClose = vi.spyOn(FileWatchService.prototype, "close");

    await expect(booted.handle.close()).resolves.toBeUndefined();

    expect(stepLines(lines, "error")).toEqual([["shutdown step failed", "terminals"]]);
    expect(fileWatchClose).toHaveBeenCalledTimes(1);
    expect(booted.handle.httpServer.listening).toBe(false);
    expect(existsSync(join(booted.home, "pi-studio.pid"))).toBe(false);
  });

  it("resolves by the deadline when a step never returns, and the PID file is gone", async () => {
    const { logger, lines } = recordingLogger();
    const booted = await boot({ logger });
    handle = booted.handle;
    vi.spyOn(FileWatchService.prototype, "close").mockImplementation(never);
    const pidFile = join(booted.home, "pi-studio.pid");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let resolved = false;
      const closing = booted.handle.close().then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
      expect(resolved).toBe(false);
      expect(existsSync(pidFile)).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await closing;
      expect(existsSync(pidFile)).toBe(false);
      expect(stepLines(lines, "warn")).toEqual([
        ["shutdown step still running at the deadline: abandoned", "file watch"],
        ["shutdown step skipped: the deadline passed", "status service"],
        ["shutdown step skipped: the deadline passed", "log service"],
        ["shutdown step skipped: the deadline passed", "relay"],
        ["shutdown step skipped: the deadline passed", "sockets"],
        ["shutdown step skipped: the deadline passed", "http"],
      ]);
    } finally {
      vi.useRealTimers();
      // The skipped steps left the listener open.
      await closeHttpServer(booted.handle.httpServer);
    }
  });

  it("refuses new connections and requests from the start, while the agents close", async () => {
    const booted = await boot();
    handle = booted.handle;
    await expectRefusalWhileAgentsClose({
      port: booted.port,
      cwd: booted.home,
      close: () => booted.handle.close(),
      agentCount: async () => (await loadAllAgents(booted.home, silentLogger())).length,
    });
  }, 15000);

  it("stops in order: accepting, agents, terminals, installs, login flows, transfers, file watch, services, relay, sockets, HTTP, PID file", async () => {
    const { logger, lines } = recordingLogger();
    const booted = await boot({ logger, relay: true });
    handle = booted.handle;

    await booted.handle.close();

    expect(doneSteps(lines)).toEqual([
      "stop accepting",
      "agents",
      "terminals",
      "installs",
      "login flows",
      "transfers",
      "file watch",
      "status service",
      "log service",
      "relay",
      "sockets",
      "http",
      "pid file",
    ]);
    expect(stepLines(lines, "error")).toEqual([]);
  });
});

describe("dev daemon shutdown", () => {
  it("closes the live agent session", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const port = await listeningPort(dev.httpServer);
    const sessionClose = vi.spyOn(MockAgentSession.prototype, "close");
    const client = await connect(port);
    try {
      await spawnMockAgent(client, tmpdir());
      expect(dev.manager.listAll().some((m) => m.session !== null)).toBe(true);
    } finally {
      await dev.close();
      client.close();
    }
    expect(sessionClose).toHaveBeenCalledTimes(1);
    expect(dev.manager.listAll().every((m) => m.session === null)).toBe(true);
  }, 15000);

  it("refuses new connections and requests from the start, while the agents close", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const port = await listeningPort(dev.httpServer);
    await expectRefusalWhileAgentsClose({
      port,
      cwd: tmpdir(),
      close: () => dev.close(),
      agentCount: () => Promise.resolve(dev.manager.listAll().length),
    });
  }, 15000);

  it("stops in order: accepting, agents, terminals, transfers, services, sockets, HTTP; a second close is the first", async () => {
    const { logger, lines } = recordingLogger();
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger });
    await listeningPort(dev.httpServer);

    const first = dev.close();
    expect(dev.close()).toBe(first);
    await first;

    expect(doneSteps(lines)).toEqual([
      "stop accepting",
      "agents",
      "terminals",
      "transfers",
      "status service",
      "log service",
      "sockets",
      "http",
    ]);
    expect(dev.httpServer.listening).toBe(false);
  });
});
