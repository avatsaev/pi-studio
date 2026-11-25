import { afterEach, describe, expect, it } from "vitest";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { silentLogger, startDevDaemon, type DevBootstrapHandle } from "@av-pi-studio/server";

import {
  createWebSocketTransport,
  DaemonClient,
  PiStudioClient,
  type AnyWebSocket,
} from "./index.js";

let handle: DevBootstrapHandle | undefined;
const cleanups: Array<() => void> = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0)) fn();
  await handle?.close();
  handle = undefined;
});

function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  return new Promise<number>((resolve, reject) => {
    server.once("listening", () => resolve((server.address() as AddressInfo).port));
    server.once("error", reject);
  });
}

describe("dev daemon (throwaway)", () => {
  it("send resolves {agentId}; waitForIdle follows the turn", async () => {
    handle = startDevDaemon({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger(),
      mockTurnDelayMs: 50,
    });
    const port = await listeningPort(handle.httpServer);
    const daemon = new DaemonClient({
      url: `ws://127.0.0.1:${port}`,
      clientId: "tmp-check",
      clientType: "cli",
      transport: createWebSocketTransport((url) => new WebSocket(url) as unknown as AnyWebSocket),
    });
    await daemon.connect();
    cleanups.push(() => daemon.close());
    const client = new PiStudioClient(daemon);

    const created = await client.createAgent({
      config: { provider: "mock", cwd: "/tmp" },
      initialPrompt: "hello",
      labels: {},
    });
    console.log("created", created);
    expect(created.agentId).toBeTruthy();
    const agent = client.agent(created.agentId);

    const t0 = Date.now();
    const first = await agent.waitForIdle({ timeoutMs: 10_000 });
    console.log("first wait", first, Date.now() - t0, "ms");
    expect(first.status).toBe("idle");

    const sent = await agent.send("again");
    console.log("sent", sent);
    expect(sent).toEqual({ agentId: created.agentId });
    await expect(agent.send("too soon")).rejects.toMatchObject({ code: "busy" });
    const second = await agent.waitForIdle({ timeoutMs: 10_000 });
    expect(second.status).toBe("idle");

    await expect(client.agent("no-such-agent").waitForIdle()).resolves.toEqual({
      status: "closed",
    });

    await agent.send("before archive");
    const waiting = agent.waitForIdle({ timeoutMs: 10_000 });
    const closedOrIdle = await waiting;
    console.log("third wait", closedOrIdle);

    await agent.send("once more");
    const closing = agent.waitForIdle({ timeoutMs: 10_000 });
    await agent.archive();
    const archived = await closing;
    console.log("archive wait", archived);
  });
});
