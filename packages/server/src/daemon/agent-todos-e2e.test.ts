import { afterEach, describe, expect, it } from "vitest";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { silentLogger } from "../logging/logger.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Daemon-level agent-todos test (swe/features/agent-todos.md; sprint-079/task-007). Boots a REAL
 * dev daemon (mock provider, real WS sessions) and drives the `#todo …` recipes through the actual
 * prompt path, proving the wiring end to end: the service attaches through the single
 * `onSessionAttached` slot (alongside the extension-UI bridge), the broadcast reaches every
 * connection, the list RPC dispatches through the real router and the archive sweep fires.
 */

let handle: DevBootstrapHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

interface Client {
  messages: Record<string, unknown>[];
  rpc: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
}

async function connect(port: number): Promise<Client & { status: Record<string, unknown> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (msg: Record<string, unknown>) => void>();
  const messages: Record<string, unknown>[] = [];
  const status = await new Promise<Record<string, unknown>>((resolve, reject) => {
    ws.once("open", () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          clientId: `test-${Math.random().toString(36).slice(2)}`,
          clientType: "cli",
          protocolVersion: 1,
        }),
      );
    });
    ws.on("message", (data: Buffer) => {
      const env = JSON.parse(data.toString("utf8"));
      if (env.type === "status") resolve(env);
      if (env.type === "session" && env.message) {
        messages.push(env.message);
        if (env.message.requestId) pending.get(env.message.requestId)?.(env.message);
      }
    });
    ws.once("error", reject);
  });

  const rpc = (message: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const requestId = `req-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${message.type}`)), 4000);
      pending.set(requestId, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      ws.send(JSON.stringify({ type: "session", message: { ...message, requestId } }));
    });

  return { messages, rpc, close: () => ws.close(), status };
}

async function waitFor(
  client: Client,
  pred: (m: Record<string, unknown>) => boolean,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = client.messages.find(pred);
    if (found) return found;
    if (Date.now() > deadline) throw new Error("waitFor: timed out waiting for a matching message");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  return new Promise<number>((resolve, reject) => {
    server.once("listening", () => resolve((server.address() as AddressInfo).port));
    server.once("error", reject);
  });
}

interface Snapshot {
  agentId: string;
  seq: number;
  tasks: { id: number; status: string; activeForm?: string }[];
  truncated?: boolean;
}
const updates = (client: Client): Snapshot[] =>
  client.messages.filter((m) => m.type === "agent_todos_update").map((m) => m.snapshot as Snapshot);

describe("agent todos, real dev daemon (sprint-079/task-007)", () => {
  it("advertises the feature, broadcasts each recipe with a rising seq, lists for a late client, and sweeps on archive", async () => {
    const dev = startDevDaemon({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger(),
      mockTurnDelayMs: 5,
    });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const a = await connect(port);
    expect((a.status.payload as { features?: Record<string, boolean> }).features?.agentTodos).toBe(
      true,
    );

    const created = await a.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd: "/tmp" },
      initialPrompt: "#todo plan",
    });
    const agentId = (created.payload as { agentId: string }).agentId;

    const first = await waitFor(a, (m) => m.type === "agent_todos_update");
    const planned = first.snapshot as Snapshot;
    expect(planned).toMatchObject({ agentId, seq: 1 });
    expect(planned.tasks).toHaveLength(4);
    expect(planned.tasks[0]).toMatchObject({ status: "in_progress" });
    expect(planned.tasks[0]!.activeForm).toEqual(expect.any(String));

    // The turn ends with the list unchanged: the settle reconcile must not add a second broadcast.
    await waitFor(
      a,
      (m) => m.type === "agent_stream" && (m.event as { kind: string }).kind === "turn_completed",
    );
    expect(updates(a)).toHaveLength(1);

    await a.rpc({ type: "send_agent_prompt", agentId, prompt: "#todo advance" });
    await waitFor(a, (m) => m.type === "agent_todos_update" && (m.snapshot as Snapshot).seq === 2);
    const advanced = updates(a)[1]!;
    expect(advanced.tasks.filter((t) => t.status === "completed")).toHaveLength(1);
    expect(advanced.tasks.filter((t) => t.status === "in_progress")).toHaveLength(1);

    // A connection opened later gets the latest snapshot from the list RPC, flat (no payload/ok).
    const b = await connect(port);
    const listed = await b.rpc({ type: "agent_todos_list_request", agentId });
    expect(listed.type).toBe("agent_todos_list_response");
    expect(listed.ok).toBeUndefined();
    expect(listed.snapshot).toEqual(advanced);

    const unknown = await b.rpc({ type: "agent_todos_list_request", agentId: "no-such-agent" });
    expect(unknown).toMatchObject({
      type: "agent_todos_list_response",
      ok: false,
      error: "not_found",
    });
    expect(unknown.snapshot).toBeUndefined();

    // Both connections hear the broadcast; archive clears the list with seq + 1 on every one.
    await a.rpc({ type: "archive_agent", agentId });
    for (const client of [a, b]) {
      await waitFor(
        client,
        (m) => m.type === "agent_todos_update" && (m.snapshot as Snapshot).seq === 3,
      );
      const last = updates(client).at(-1)!;
      expect(last).toMatchObject({ agentId, seq: 3, tasks: [] });
    }

    a.close();
    b.close();
  });

  it("an agent that never produces todos broadcasts nothing and lists an empty snapshot", async () => {
    const dev = startDevDaemon({
      host: "127.0.0.1",
      port: 0,
      logger: silentLogger(),
      mockTurnDelayMs: 5,
    });
    handle = dev;
    const client = await connect(await listeningPort(dev.httpServer));
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd: "/tmp" },
      initialPrompt: "hello",
    });
    const agentId = (created.payload as { agentId: string }).agentId;
    await waitFor(
      client,
      (m) => m.type === "agent_stream" && (m.event as { kind: string }).kind === "turn_completed",
    );

    expect(updates(client)).toHaveLength(0);
    const listed = await client.rpc({ type: "agent_todos_list_request", agentId });
    expect(listed.snapshot).toEqual({ agentId, seq: 0, tasks: [] });
    client.close();
  });
});
