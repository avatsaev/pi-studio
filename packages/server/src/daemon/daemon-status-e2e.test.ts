import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { silentLogger } from "../logging/logger.js";
import { DaemonStatusService } from "../observability/daemon-status-service.js";
import { registerDaemonStatusHandlers } from "../observability/daemon-status-rpc.js";
import {
  authenticatedRpc,
  startAuthGatedServer,
  unauthenticatedUpgradeStatus,
} from "../test-support/auth-gated-rpc.js";
import {
  connectTestClient,
  listeningPort,
  messageOf,
  type TestClient,
} from "../test-support/daemon-test-client.js";
import { SERVER_VERSION } from "../version.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Daemon status RPC over a real socket (sprint-084/task-005; swe/features/daemon-status-rpc.md).
 * Boots the real dev daemon with two clients. The 5 s push interval is driven by fake
 * `setInterval` only, so no test waits on a real 5 s timer.
 */

let handle: DevBootstrapHandle | undefined;
const clients: TestClient[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const c of clients.splice(0)) await c.close();
  await handle?.close();
  handle = undefined;
  for (const fn of cleanups.splice(0).toReversed()) await fn();
});

async function boot(): Promise<{ a: TestClient; b: TestClient }> {
  handle = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
  const port = await listeningPort(handle.httpServer);
  const a = await connectTestClient(port);
  const b = await connectTestClient(port, { appVersion: "pistudiodashboard/0.1.0" });
  clients.push(a, b);
  return { a, b };
}

const updates = (c: TestClient): unknown[] =>
  c.frames.filter((f) => messageOf(f).type === "daemon_status_update");

describe("daemon status over the dev daemon (sprint-084/task-005)", () => {
  it("answers a one-shot request with the process/version shape", async () => {
    const { a } = await boot();
    const features = (a.status.payload as { features: Record<string, boolean> }).features;
    expect(features.daemonObservability).toBe(true);
    // The legacy flag stays advertised but has no handler behind it (D30).
    expect(features.daemonStatusRpc).toBe(true);
    const legacy = await a.rpcFrame("daemonStatusRpc");
    expect(messageOf(legacy)).toMatchObject({ type: "rpc_error", code: "unknown_message_type" });
    const res = await a.rpc("daemon_status_request");
    expect(res.type).toBe("daemon_status_response");
    expect(res.payload).toMatchObject({
      version: SERVER_VERSION,
      pid: process.pid,
      nodeVersion: process.version,
    });
    const payload = res.payload as { memory: { rss: number } };
    expect(payload.memory.rss).toBeGreaterThan(0);
  });

  it("counts non-archived agents by status", async () => {
    const { a } = await boot();
    const create = async (): Promise<string> => {
      const created = await a.rpc("create_agent_request", {
        config: { provider: "mock", cwd: "/tmp" },
      });
      return (created.payload as { agentId: string }).agentId;
    };
    await create();
    const archivedId = await create();
    await a.rpc("archive_agent", { agentId: archivedId });
    const { payload } = await a.rpc("daemon_status_request");
    const counts = (payload as { agentsByStatus: Record<string, number> }).agentsByStatus;
    expect(Object.values(counts).reduce((x, y) => x + y, 0)).toBe(1);
  });

  it("lists every client, including the requester, ordered, with metadata", async () => {
    const { a, b } = await boot();
    const { payload } = await b.rpc("daemon_status_request");
    const list = (
      payload as {
        clients: {
          clientId: string;
          appVersion?: string;
          transport: string;
          remoteAddress?: string;
          connectedAt: number;
        }[];
      }
    ).clients;
    expect(list).toHaveLength(2);
    expect(list[0]!.connectedAt).toBeLessThanOrEqual(list[1]!.connectedAt);
    const self = list.find((c) => c.appVersion === "pistudiodashboard/0.1.0");
    expect(self).toBeDefined();
    expect(list.find((c) => c.appVersion === undefined)).toBeDefined();
    for (const c of list) {
      expect(c.transport).toBe("direct");
      expect(c.remoteAddress).toEqual(expect.any(String));
    }
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("pushes to subscribers, stops on unsubscribe, and stops when the socket closes", async () => {
    const { a, b } = await boot();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const subA = await a.rpc("daemon_status_subscribe_request");
    expect(subA.payload).toMatchObject({ ok: true, intervalMs: 5000 });
    await b.rpc("daemon_status_subscribe_request");

    vi.advanceTimersByTime(5000);
    await a.waitFor((f) => messageOf(f).type === "daemon_status_update");
    await b.waitFor((f) => messageOf(f).type === "daemon_status_update");
    expect(updates(a)).toHaveLength(1);

    const unsub = await a.rpc("daemon_status_unsubscribe_request");
    expect(unsub.payload).toEqual({ ok: true });
    vi.advanceTimersByTime(5000);
    await b.waitFor(() => updates(b).length === 2);
    expect(updates(a)).toHaveLength(1);

    await b.close();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0));
  });
});

describe("daemon status is authenticated only (sprint-084/task-005)", () => {
  it("rejects an unauthenticated socket and serves an authenticated one", async () => {
    let service: DaemonStatusService | undefined;
    const server = await startAuthGatedServer((registry, sessions) => {
      service = new DaemonStatusService({
        listAgents: () => [],
        getActiveSessions: sessions,
        send: (s, e) => s.send(e),
      });
      registerDaemonStatusHandlers(registry, { service });
    });
    cleanups.push(async () => {
      service?.dispose();
      await server.close();
    });

    expect(await unauthenticatedUpgradeStatus(server.port)).toBe(401);
    const res = await authenticatedRpc(server.port, "daemon_status_request");
    expect(res.type).toBe("daemon_status_response");
  });
});
