import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { MockAgentSession } from "../agent/providers/mock/mock-provider.js";
import { silentLogger } from "../logging/logger.js";
import { TerminalManager } from "../terminal/terminal-manager.js";
import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { startDevDaemon } from "./dev-bootstrap.js";

/**
 * Shutdown of the production and dev daemons (features/self-update.md § Shutdown): every live agent
 * session is closed, terminals are killed, and `pi-studio.pid` is removed when it still names this
 * process. Every daemon binds port 0 under a temp `PI_STUDIO_HOME`.
 */

let handle: DaemonHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  vi.restoreAllMocks();
});

interface Client {
  rpc: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
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
    if (env.type === "session" && env.message?.requestId) {
      pending.get(env.message.requestId)?.(env.message);
    }
  });
  ws.once("error", ready.reject);
  await ready.promise;

  const rpc = (message: Record<string, unknown>) => {
    const requestId = `req-${Math.random().toString(36).slice(2)}`;
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    const timer = setTimeout(() => reject(new Error(`rpc timeout: ${message.type}`)), 4000);
    pending.set(requestId, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    ws.send(JSON.stringify({ type: "session", message: { ...message, requestId } }));
    return promise;
  };
  return { rpc, close: () => ws.close() };
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

async function boot(): Promise<{ handle: DaemonHandle; port: number; home: string }> {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-shutdown-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-shutdown-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { piHome, extensions: { autoSync: false } } }),
    "utf8",
  );
  const h = startDaemon({ host: "127.0.0.1", port: 0, home, logger: silentLogger() });
  return { handle: h, port: await listeningPort(h.httpServer), home };
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
});
