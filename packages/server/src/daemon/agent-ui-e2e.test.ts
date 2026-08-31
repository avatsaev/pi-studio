import { afterEach, describe, expect, it } from "vitest";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import type { MockAgentSession } from "../agent/providers/mock/mock-provider.js";
import { silentLogger } from "../logging/logger.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Daemon-level extension-UI test (swe/features/extension-ui-rpc.md; sprint-066/task-004). Boots a
 * REAL dev daemon (mock provider, real WS sessions), proving the wiring end to end: `attach()`
 * happens with no per-call-site threading (`onSessionAttached` fires from the single
 * `attachSession` choke point), the RPC handlers dispatch through the real router, and the
 * lifecycle sweeps (respawn/archive/delete) and preserves (interrupt/disconnect) all hold through
 * the actual bootstrap — not just through direct service calls (`agent-ui-service.test.ts` and
 * `agent-ui-rpc.test.ts` already cover those in isolation).
 */

let handle: DevBootstrapHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

interface Client {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  rpc: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
}

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (msg: Record<string, unknown>) => void>();
  const messages: Record<string, unknown>[] = [];

  await new Promise<void>((resolve, reject) => {
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
      if (env.type === "status") resolve();
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

  return { ws, messages, rpc, close: () => ws.close() };
}

/** Broadcasts (`agent_ui_request`/`agent_ui_resolved`) carry no matching RPC promise — poll the
 *  client's own message log for the first one matching `pred`. */
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

/**
 * Resolves with the port the OS actually assigned to `server`.
 *
 * Every dev daemon here binds `port: 0` and learns its port from this helper rather than guessing
 * one out of a fixed range. Guessing was a real flake source: vitest runs test files in parallel
 * *processes*, but those processes still share the machine's single port space, so two
 * concurrently-booting daemons could pick the same port. The loser hit `EADDRINUSE`, which
 * surfaced as an unhandled rejection attributed to whichever test happened to be running — with
 * every test still reported as passing. `port: 0` makes the collision impossible by construction.
 */
function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  return new Promise<number>((resolve, reject) => {
    server.once("listening", () => resolve((server.address() as AddressInfo).port));
    server.once("error", reject);
  });
}

async function createMockAgent(client: Client): Promise<string> {
  const created = await client.rpc({
    type: "create_agent_request",
    config: { provider: "mock", cwd: "/tmp" },
    initialPrompt: "hello",
  });
  return (created.payload as { agentId: string }).agentId;
}

describe("extension UI, real dev daemon (sprint-066/task-004)", () => {
  it("server_info.features.extensionUi is advertised on boot", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const status = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.once("open", () => {
        ws.send(
          JSON.stringify({ type: "hello", clientId: "t", clientType: "cli", protocolVersion: 1 }),
        );
      });
      ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString("utf8"))));
      ws.once("error", reject);
    });
    ws.close();
    const payload = status.payload as { features?: Record<string, boolean> };
    expect(payload.features?.extensionUi).toBe(true);
  });

  it("broadcast → answer → resolve round-trip: proves attach happens with no per-call-site threading", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const client = await connect(port);

    const agentId = await createMockAgent(client);
    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;
    expect(agentSession).toBeDefined();

    const req = agentSession.emitUiRequest({ method: "confirm", payload: { message: "Proceed?" } });
    const broadcast = await waitFor(client, (m) => m.type === "agent_ui_request");
    expect(broadcast.requestId).not.toBe(req.requestId);
    expect(broadcast.agentId).toBe(agentId);

    const answer = await client.rpc({
      type: "agent_ui_respond_request",
      uiRequestId: broadcast.requestId,
      response: { confirmed: true },
    });
    expect(answer.type).toBe("agent_ui_respond_response");
    expect(answer.payload).toEqual({ ok: true });

    const resolved = await waitFor(
      client,
      (m) => m.type === "agent_ui_resolved" && m.requestId === broadcast.requestId,
    );
    expect(resolved.reason).toBe("answered");
    expect(agentSession.uiResponses).toEqual([
      { providerRequestId: req.requestId, response: { confirmed: true } },
    ]);

    client.close();
  });

  it("disconnect-survival: a dialog stays pending and answerable after the receiving client disconnects", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const clientA = await connect(port);
    const agentId = await createMockAgent(clientA);
    const clientB = await connect(port);

    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;
    const req = agentSession.emitUiRequest({ method: "select" });
    const broadcastA = await waitFor(clientA, (m) => m.type === "agent_ui_request");
    const broadcastB = await waitFor(clientB, (m) => m.type === "agent_ui_request");
    expect(broadcastA.requestId).toBe(broadcastB.requestId);

    clientA.close();
    await new Promise((r) => setTimeout(r, 50)); // let the server observe the close

    const answer = await clientB.rpc({
      type: "agent_ui_respond_request",
      uiRequestId: broadcastB.requestId,
      response: { value: "Allow" },
    });
    expect(answer.payload).toEqual({ ok: true });
    expect(agentSession.uiResponses).toEqual([
      { providerRequestId: req.requestId, response: { value: "Allow" } },
    ]);

    clientB.close();
  });

  it("a forced respawn sweeps old pending as aborted; the new session attaches; stale ids answer not_found", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const client = await connect(port);
    const agentId = await createMockAgent(client);

    const oldSession = dev.manager.get(agentId)?.session as MockAgentSession;
    oldSession.emitUiRequest({ method: "confirm" });
    const broadcast = await waitFor(client, (m) => m.type === "agent_ui_request");

    await client.rpc({ type: "resume_agent", agentId });

    const resolved = await waitFor(
      client,
      (m) => m.type === "agent_ui_resolved" && m.requestId === broadcast.requestId,
    );
    expect(resolved.reason).toBe("aborted");
    expect(oldSession.uiResponses).toEqual([
      { providerRequestId: expect.any(String), response: { cancelled: true } },
    ]);

    const stale = await client.rpc({
      type: "agent_ui_respond_request",
      uiRequestId: broadcast.requestId,
      response: {},
    });
    expect(stale.payload).toEqual({ ok: false, error: "not_found" });

    const newSession = dev.manager.get(agentId)?.session as MockAgentSession;
    expect(newSession).not.toBe(oldSession);

    client.close();
  });

  it("a late-joining client rebuilds a retained surface from agent_ui_list_request alone, no live-frame replay (sprint-066/task-006, mock-path fallback — see summary: rpiv-todo's real widget uses Pi's TUI-only factory `setWidget` form, which never reaches RPC mode as an `extension_ui_request`)", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const clientA = await connect(port);
    const agentId = await createMockAgent(clientA);
    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;

    agentSession.emitUiRequest({
      method: "setWidget",
      expectsResponse: false,
      surfaceKey: "widget:todo",
      payload: { widgetLines: ["1. write tests", "2. ship feature"] },
    });
    await waitFor(clientA, (m) => m.type === "agent_ui_request" && m.method === "setWidget");

    // Connects strictly AFTER the surface event above — any `agent_ui_request` this client
    // observes would prove replay, which the family deliberately never does (retained surfaces
    // rebuild from `agent_ui_list_request` alone).
    const clientB = await connect(port);
    const listed = await clientB.rpc({ type: "agent_ui_list_request", agentId });
    const payload = listed.payload as { surfaces: Array<Record<string, unknown>> };
    expect(payload.surfaces).toEqual([
      expect.objectContaining({
        agentId,
        surfaceKey: "widget:todo",
        payload: { widgetLines: ["1. write tests", "2. ship feature"] },
      }),
    ]);
    expect(clientB.messages.some((m) => m.type === "agent_ui_request")).toBe(false);

    clientA.close();
    clientB.close();
  });

  it("a status/widget clear (fields omitted) removes the surface from agent_ui_list_response (sprint-066/task-006, mock-path fallback)", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const client = await connect(port);
    const agentId = await createMockAgent(client);
    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;

    agentSession.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:build",
      payload: { statusText: "building…" },
    });
    await waitFor(client, (m) => m.type === "agent_ui_request" && m.method === "setStatus");
    const before = await client.rpc({ type: "agent_ui_list_request", agentId });
    expect((before.payload as { surfaces: unknown[] }).surfaces).toHaveLength(1);

    agentSession.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:build",
      removed: true,
      payload: {},
    });
    await waitFor(client, (m) => m.type === "agent_ui_request" && m.removed === true);

    const after = await client.rpc({ type: "agent_ui_list_request", agentId });
    expect((after.payload as { surfaces: unknown[] }).surfaces).toEqual([]);

    client.close();
  });

  it("archiving an agent sweeps its pending dialogs and surfaces", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const client = await connect(port);
    const agentId = await createMockAgent(client);
    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;

    agentSession.emitUiRequest({ method: "confirm" });
    agentSession.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:x",
      payload: { statusText: "running" },
    });
    await waitFor(client, (m) => m.type === "agent_ui_request" && m.method === "setStatus");

    await client.rpc({ type: "archive_agent", agentId });
    await waitFor(client, (m) => m.type === "agent_ui_resolved" && m.reason === "aborted");

    const listed = await client.rpc({ type: "agent_ui_list_request", agentId });
    expect(listed.payload).toMatchObject({ ok: true, pending: [], surfaces: [] });

    client.close();
  });

  it("deleting an agent sweeps its pending dialogs and surfaces", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const client = await connect(port);
    const agentId = await createMockAgent(client);
    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;

    agentSession.emitUiRequest({ method: "input" });
    await waitFor(client, (m) => m.type === "agent_ui_request");

    await client.rpc({ type: "delete_agent", agentId });
    await waitFor(client, (m) => m.type === "agent_ui_resolved" && m.reason === "aborted");

    const listed = await client.rpc({ type: "agent_ui_list_request", agentId });
    expect(listed.payload).toMatchObject({ ok: true, pending: [], surfaces: [] });

    client.close();
  });

  it("interrupting an agent leaves its pending dialogs and surfaces intact (the scope's explicit inverse rule)", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const client = await connect(port);
    const agentId = await createMockAgent(client);
    const agentSession = dev.manager.get(agentId)?.session as MockAgentSession;

    agentSession.emitUiRequest({ method: "editor" });
    agentSession.emitUiRequest({
      method: "setWidget",
      expectsResponse: false,
      surfaceKey: "widget:x",
      payload: { widgetLines: ["a"] },
    });
    await waitFor(client, (m) => m.type === "agent_ui_request" && m.method === "setWidget");

    await client.rpc({ type: "interrupt_agent", agentId });

    const listed = await client.rpc({ type: "agent_ui_list_request", agentId });
    const payload = listed.payload as { pending: unknown[]; surfaces: unknown[] };
    expect(payload.pending).toHaveLength(1);
    expect(payload.surfaces).toHaveLength(1);

    client.close();
  });
});
