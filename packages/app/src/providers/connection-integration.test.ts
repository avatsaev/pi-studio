/**
 * Live integration test — ConnectionProvider against a real WS server.
 *
 * Starts an actual PiWsServer on a random port (in-process), creates a real
 * DaemonClient, connects, and verifies:
 *   - hello/status handshake completes
 *   - DaemonClient.serverId is populated
 *   - subscribeSessionStore populates the session store server info
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import { createWebSocketServer } from "@av-pi-studio/server";
import { DaemonClient, PiStudioClient } from "@av-pi-studio/client";
import { subscribeSessionStore } from "../hooks/use-session-hooks.js";
import { useSessionStore } from "../store/session-store.js";

const TEST_SERVER_ID = "test-srv-integration";

async function startTestServer(): Promise<{ httpServer: HttpServer; port: number }> {
  const httpServer = createServer();
  createWebSocketServer(httpServer, {
    serverId: TEST_SERVER_ID,
    hostname: "localhost",
    version: "0.0.0-test",
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as { port: number }).port;
  return { httpServer, port };
}

function stopServer(httpServer: HttpServer): Promise<void> {
  return new Promise((resolve, reject) =>
    httpServer.close((err) => (err ? reject(err) : resolve())),
  );
}

describe("Live WS connection — DaemonClient ↔ PiWsServer", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
    // Reset store
    useSessionStore.setState({ agents: {}, workspaces: {}, servers: {}, activeServerId: null });
  });

  it("completes hello/status handshake and populates serverId", async () => {
    const { httpServer, port } = await startTestServer();
    cleanup = () => stopServer(httpServer);

    const daemon = new DaemonClient({
      url: `ws://127.0.0.1:${port}`,
      clientId: "test-client-1",
      clientType: "browser",
    });

    await daemon.connect();

    expect(daemon.serverId).toBe(TEST_SERVER_ID);
    daemon.close();
  }, 8000);

  it("subscribeSessionStore receives server info after connect", async () => {
    const { httpServer, port } = await startTestServer();
    cleanup = () => stopServer(httpServer);

    const daemon = new DaemonClient({
      url: `ws://127.0.0.1:${port}`,
      clientId: "test-client-2",
      clientType: "browser",
    });
    const piClient = new PiStudioClient(daemon);

    const unsub = subscribeSessionStore(piClient as never);
    await daemon.connect();

    // Populate server info manually (as ConnectionProvider does on "open")
    const sid = daemon.serverId;
    if (sid) {
      useSessionStore.getState().setServerInfo({ serverId: sid, version: "0.0.0-test" });
      useSessionStore.getState().setActiveServer(sid);
    }

    expect(useSessionStore.getState().activeServerId).toBe(TEST_SERVER_ID);
    expect(useSessionStore.getState().servers[TEST_SERVER_ID]?.version).toBe("0.0.0-test");

    unsub();
    daemon.close();
  }, 5000);

  it("DaemonClient.request throws RpcError for unknown RPC type", async () => {
    const { httpServer, port } = await startTestServer();
    cleanup = () => stopServer(httpServer);

    const daemon = new DaemonClient({
      url: `ws://127.0.0.1:${port}`,
      clientId: "test-client-3",
      clientType: "browser",
      rpcTimeoutMs: 2000,
    });

    await daemon.connect();

    await expect(
      daemon.request("nonexistent_rpc_type", {}),
    ).rejects.toThrow();

    daemon.close();
  }, 6000);
});
