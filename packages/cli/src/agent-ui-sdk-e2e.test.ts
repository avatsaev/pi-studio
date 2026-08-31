import { afterEach, describe, expect, it } from "vitest";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import {
  createAgentUiController,
  createWebSocketTransport,
  DaemonClient,
  PiStudioClient,
  type AgentUiController,
  type AgentUiState,
  type AnyWebSocket,
} from "@av-pi-studio/client";
import {
  silentLogger,
  startDevDaemon,
  type DevBootstrapHandle,
  type MockAgentSession,
} from "@av-pi-studio/server";

/**
 * Cross-package E2E for the extension-UI client SDK (sprint-067/task-004). Boots a REAL dev
 * daemon (`@av-pi-studio/server`) and drives it with REAL `PiStudioClient`s + `AgentUiController`s
 * (`@av-pi-studio/client`) over a real WebSocket — proving interoperability, not just internal
 * consistency with the scripted transport tasks 001-003 authored and verified against.
 *
 * Lives here, not in `client` or `server`, because those two packages have no dependency edge in
 * either direction (`docs/build-layering.md`); `cli` is the only package that already depends on
 * both. See the task's own "Context / why" for the full argument.
 *
 * Surfaces are proven against the **mock** provider only — sprint-066/task-006 established live,
 * against a real `pi --mode rpc` process, that Pi's TUI-only `ctx.ui.custom(...)`/`setWidget`
 * factory forms never reach RPC mode as an `extension_ui_request` at all in this Pi version, so a
 * surface can never be observed through a real Pi turn. The real-Pi smoke below (recorded in the
 * task summary, not here) therefore covers the dialog path only.
 */

let handle: DevBootstrapHandle | undefined;
let cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanups.toReversed()) await fn();
  cleanups = [];
  await handle?.close();
  handle = undefined;
});

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

async function connectClient(
  port: number,
  clientId: string,
): Promise<{ client: PiStudioClient; daemon: DaemonClient }> {
  const daemon = new DaemonClient({
    url: `ws://127.0.0.1:${port}`,
    clientId,
    clientType: "cli",
    transport: createWebSocketTransport((url) => new WebSocket(url) as unknown as AnyWebSocket),
  });
  await daemon.connect();
  cleanups.push(() => daemon.close());
  return { client: new PiStudioClient(daemon), daemon };
}

function trackController(controller: AgentUiController): AgentUiController {
  cleanups.push(() => controller.dispose());
  return controller;
}

async function createMockAgent(client: PiStudioClient): Promise<string> {
  // initialPrompt is required — without it, create_agent_request takes the deferred-draft path
  // (no process spawned, no session ever attached), and `manager.get(agentId)?.session` stays null.
  const created = await client.createAgent({
    config: { provider: "mock", cwd: "/tmp" },
    labels: {},
    initialPrompt: "hello",
  });
  return created.agentId;
}

// Both helpers below poll/await against a REAL daemon process over a REAL WebSocket (no fake
// clock can substitute for genuine network/process scheduling here) — the
// integration-test exception this codebase's own timer convention carves out. Each wait is bound
// to an actual observable condition (a state predicate, a real connection transition), never a
// blind "long enough" delay.
async function waitForState(
  controller: AgentUiController,
  pred: (state: AgentUiState) => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred(controller.getState())) return;
    if (Date.now() > deadline) {
      throw new Error(
        `waitForState: timed out; last state = ${JSON.stringify(controller.getState())}`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Waits for `daemon.state` to reach `target` via a real transition, not a poll — avoids a race
 *  where a stale socket's delayed close event lands after a fresh reconnect (see scenario below). */
function waitForConnectionState(
  daemon: DaemonClient,
  target: "closed" | "open",
  timeoutMs = 3000,
): Promise<void> {
  if (daemon.state === target) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    unsub();
    reject(new Error(`waitForConnectionState: timed out waiting for "${target}"`));
  }, timeoutMs);
  const unsub = daemon.onStateChange((s) => {
    if (s === target) {
      clearTimeout(timer);
      unsub();
      resolve();
    }
  });
  return promise;
}

describe("extension UI SDK, real dev daemon (sprint-067/task-004)", () => {
  it("extensionUiAvailable() is true against this dev daemon (capability gate)", async () => {
    handle = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const port = await listeningPort(handle.httpServer);
    const { client } = await connectClient(port, "e2e-cap");
    expect(client.extensionUiAvailable()).toBe(true);
  });

  it("answer round-trip: respond resolves ok:true, the entry clears via a real agent_ui_resolved, and the provider sees the value", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const { client } = await connectClient(port, "e2e-roundtrip");
    const agentId = await createMockAgent(client);
    const controller = trackController(createAgentUiController(client));

    const session = dev.manager.get(agentId)?.session as MockAgentSession;
    const req = session.emitUiRequest({ method: "select", payload: { message: "Pick one" } });

    await waitForState(controller, (s) => Object.keys(s.pending).length > 0);
    const entry = Object.values(controller.getState().pending)[0]!;
    expect(entry.agentId).toBe(agentId);
    expect(entry.method).toBe("select");

    const result = await controller.respond(entry.requestId, { value: "a" });
    expect(result).toEqual({ ok: true });

    await waitForState(controller, (s) => !(entry.requestId in s.pending));

    const recorded = session.uiResponses.find((r) => r.providerRequestId === req.requestId);
    expect(recorded?.response.value).toBe("a");
  });

  it("first-answer-wins across two clients: the loser gets ok:false reason not_found with no throw, and its entry clears from the broadcast", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const { client: clientA } = await connectClient(port, "e2e-race-a");
    const { client: clientB } = await connectClient(port, "e2e-race-b");
    const agentId = await createMockAgent(clientA);
    const controllerA = trackController(createAgentUiController(clientA));
    const controllerB = trackController(createAgentUiController(clientB));

    const session = dev.manager.get(agentId)?.session as MockAgentSession;
    session.emitUiRequest({ method: "select" });

    await waitForState(controllerA, (s) => Object.keys(s.pending).length > 0);
    await waitForState(controllerB, (s) => Object.keys(s.pending).length > 0);
    const idA = Object.keys(controllerA.getState().pending)[0]!;
    const idB = Object.keys(controllerB.getState().pending)[0]!;
    expect(idA).toBe(idB); // both clients saw the same daemon-minted dialog id

    await expect(controllerA.respond(idA, { value: "a" })).resolves.toEqual({ ok: true });
    await expect(controllerB.respond(idB, { value: "b" })).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });

    // B's entry clears from the broadcast, not from its own (losing) respond call.
    await waitForState(controllerB, (s) => !(idB in s.pending));
  });

  it("a late-joining client's controller rebuilds a pending dialog from the snapshot alone, with no live agent_ui_request frame ever reaching it", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const { client: earlyClient } = await connectClient(port, "e2e-rehydrate-early");
    const agentId = await createMockAgent(earlyClient);
    const earlyController = trackController(createAgentUiController(earlyClient));

    const session = dev.manager.get(agentId)?.session as MockAgentSession;
    session.emitUiRequest({ method: "select" });
    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status",
      payload: { text: "busy" },
    });
    await waitForState(
      earlyController,
      (s) => Object.keys(s.pending).length > 0 && Object.keys(s.surfaces).length > 0,
    );

    const { client: lateClient, daemon: lateDaemon } = await connectClient(
      port,
      "e2e-rehydrate-late",
    );
    const lateController = trackController(createAgentUiController(lateClient));
    const seenRequestFrames: unknown[] = [];
    lateDaemon.onSessionMessage((m) => {
      if (m.type === "agent_ui_request") seenRequestFrames.push(m);
    });

    await waitForState(
      lateController,
      (s) => Object.keys(s.pending).length > 0 && Object.keys(s.surfaces).length > 0,
    );
    expect(Object.keys(lateController.getState().pending)).toHaveLength(1);
    expect(Object.keys(lateController.getState().surfaces)).toHaveLength(1);
    expect(seenRequestFrames).toHaveLength(0);
  });

  it("reconnect resync with no consumer call: closing marks pending answerable:false, reopening auto-resyncs and flips it back", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const { client, daemon } = await connectClient(port, "e2e-reconnect");
    const agentId = await createMockAgent(client);
    const controller = trackController(createAgentUiController(client));

    const session = dev.manager.get(agentId)?.session as MockAgentSession;
    session.emitUiRequest({ method: "select" });
    await waitForState(controller, (s) => Object.keys(s.pending).length > 0);
    const id = Object.keys(controller.getState().pending)[0]!;
    expect(controller.getState().pending[id]?.answerable).toBe(true);

    daemon.close();
    await waitForConnectionState(daemon, "closed");
    await waitForState(controller, (s) => s.pending[id]?.answerable === false);

    await daemon.connect();
    await waitForState(controller, (s) => s.pending[id]?.answerable === true, 5000);
  });

  it("clear-by-omission: a surface upsert then a removed clear leaves no surface, and a freshly-synced client sees none either", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const { client } = await connectClient(port, "e2e-clear");
    const agentId = await createMockAgent(client);
    const controller = trackController(createAgentUiController(client));
    const session = dev.manager.get(agentId)?.session as MockAgentSession;

    session.emitUiRequest({
      method: "setWidget",
      expectsResponse: false,
      surfaceKey: "todo",
      payload: { items: [] },
    });
    await waitForState(controller, (s) => Object.keys(s.surfaces).length > 0);
    session.emitUiRequest({
      method: "setWidget",
      expectsResponse: false,
      surfaceKey: "todo",
      removed: true,
      payload: {},
    });
    await waitForState(controller, (s) => Object.keys(s.surfaces).length === 0);

    // An unrelated dialog gives the late client a positive presence signal to wait on, so the
    // absence assertion below isn't a blind timing guess.
    session.emitUiRequest({ method: "confirm" });
    const { client: lateClient } = await connectClient(port, "e2e-clear-late");
    const lateController = trackController(createAgentUiController(lateClient));
    await waitForState(lateController, (s) => Object.keys(s.pending).length > 0);
    expect(Object.keys(lateController.getState().surfaces)).toHaveLength(0);
  });

  it("archive pruning: dialog clears via agent_ui_resolved, surface clears via a genuine agent_archived message, never agent_update", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    handle = dev;
    const port = await listeningPort(dev.httpServer);
    const { client, daemon } = await connectClient(port, "e2e-archive");
    const agentId = await createMockAgent(client);
    const controller = trackController(createAgentUiController(client));
    const session = dev.manager.get(agentId)?.session as MockAgentSession;

    const seenTypes: string[] = [];
    daemon.onSessionMessage((m) => seenTypes.push(m.type));

    session.emitUiRequest({ method: "confirm" });
    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status",
      payload: {},
    });
    await waitForState(
      controller,
      (s) => Object.keys(s.pending).length > 0 && Object.keys(s.surfaces).length > 0,
    );

    await dev.manager.archiveAgent(agentId);
    await waitForState(
      controller,
      (s) => Object.keys(s.pending).length === 0 && Object.keys(s.surfaces).length === 0,
    );

    expect(seenTypes).toContain("agent_archived");
    expect(seenTypes).not.toContain("agent_update");
  });
});
