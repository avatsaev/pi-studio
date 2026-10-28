import { afterEach, describe, expect, it } from "vitest";
import { type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import {
  applyAgentTodosSnapshot,
  createWebSocketTransport,
  DaemonClient,
  initialAgentTodosState,
  PiStudioClient,
  resetAgentTodosSeq,
  snapshotFor,
  type AgentTodosState,
  type AnyWebSocket,
} from "@av-pi-studio/client";
import type { AgentTodosSnapshot } from "@av-pi-studio/protocol";
import { silentLogger, startDevDaemon, type DevBootstrapHandle } from "@av-pi-studio/server";

/**
 * Cross-package E2E for the agent-todos SDK (sprint-079/task-009). Boots a REAL dev daemon
 * (`@av-pi-studio/server`) and drives it with REAL `PiStudioClient`s and the pure reducer
 * (`@av-pi-studio/client`) over a real WebSocket, with the daemon's `#todo …` mock recipes as the
 * producer. Lives here because `cli` is the only package that depends on both client and server.
 */

let handle: DevBootstrapHandle | undefined;
let cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanups.toReversed()) await fn();
  cleanups = [];
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

/** The reducer folded over every push the client receives, as a consumer store would hold it. */
function trackState(client: PiStudioClient): { get: () => AgentTodosState } {
  let state = initialAgentTodosState;
  const off = client.onAgentTodosUpdate((snapshot) => {
    state = applyAgentTodosSnapshot(state, snapshot);
  });
  cleanups.push(off);
  return { get: () => state };
}

async function createMockAgent(client: PiStudioClient, initialPrompt: string): Promise<string> {
  const created = await client.createAgent({
    config: { provider: "mock", cwd: "/tmp" },
    labels: {},
    initialPrompt,
  });
  return created.agentId;
}

// Polls a REAL daemon over a REAL WebSocket: no fake clock can stand in for network/process
// scheduling (the integration-test exception to the codebase's timer convention). Each wait is
// bound to an observable condition, never a blind delay.
async function waitFor(pred: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`waitFor: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function dev(port = 0): DevBootstrapHandle {
  return startDevDaemon({ host: "127.0.0.1", port, logger: silentLogger(), mockTurnDelayMs: 5 });
}

describe("agent todos SDK, real dev daemon (sprint-079/task-009)", () => {
  it("pushes through the reducer in order, and a late joiner's list equals the live state", async () => {
    handle = dev();
    const port = await listeningPort(handle.httpServer);
    const { client } = await connectClient(port, "e2e-todos-a");
    expect(client.hasAgentTodosCapability()).toBe(true);
    const live = trackState(client);

    const agentId = await createMockAgent(client, "#todo plan");
    await waitFor(() => snapshotFor(live.get(), agentId)?.seq === 1, "the plan snapshot");
    const planned = snapshotFor(live.get(), agentId)!;
    expect(planned.tasks.map((t) => t.status)).toEqual([
      "in_progress",
      "pending",
      "pending",
      "pending",
    ]);

    await client.agent(agentId).send("#todo advance");
    await waitFor(() => snapshotFor(live.get(), agentId)?.seq === 2, "the advance snapshot");
    const advanced = snapshotFor(live.get(), agentId)!;
    expect(advanced.tasks.map((t) => t.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
      "pending",
    ]);

    // A client that connects later reads the same state in one RPC, through the same reducer.
    const { client: late } = await connectClient(port, "e2e-todos-b");
    const listed = await late.listAgentTodos(agentId);
    expect(listed).toEqual(advanced);
    const lateState = applyAgentTodosSnapshot(initialAgentTodosState, listed);
    expect(snapshotFor(lateState, agentId)).toEqual(advanced);
    // Applying the list a second time (a refetch racing a push) is a no-op, not a duplicate render.
    expect(applyAgentTodosSnapshot(lateState, listed)).toBe(lateState);

    await expect(late.listAgentTodos("no-such-agent")).rejects.toMatchObject({
      name: "AgentTodosError",
      code: "not_found",
    });
  });

  it("clear-by-recipe and archive both reach every client as an empty snapshot with a higher seq", async () => {
    handle = dev();
    const port = await listeningPort(handle.httpServer);
    const { client } = await connectClient(port, "e2e-todos-c");
    const { client: other } = await connectClient(port, "e2e-todos-d");
    const live = trackState(client);
    const otherLive = trackState(other);

    const agentId = await createMockAgent(client, "#todo many");
    await waitFor(() => snapshotFor(otherLive.get(), agentId)?.seq === 1, "the many snapshot");
    expect(snapshotFor(otherLive.get(), agentId)!.tasks).toHaveLength(12);

    await client.agent(agentId).send("#todo clear");
    await waitFor(() => snapshotFor(live.get(), agentId)?.seq === 2, "the clear snapshot");
    expect(snapshotFor(live.get(), agentId)!.tasks).toEqual([]);

    await client.agent(agentId).send("#todo plan");
    await waitFor(() => snapshotFor(live.get(), agentId)?.seq === 3, "the replan snapshot");
    await client.agent(agentId).archive();
    await waitFor(() => snapshotFor(otherLive.get(), agentId)?.seq === 4, "the archive sweep");
    expect(snapshotFor(otherLive.get(), agentId)).toMatchObject({ seq: 4, tasks: [] });
  });

  it("a daemon restart restarts seq at 1: the reset-on-reconnect rule applies the new process's snapshots", async () => {
    const first = dev();
    handle = first;
    const port = await listeningPort(first.httpServer);
    const { client, daemon } = await connectClient(port, "e2e-todos-restart");
    let state: AgentTodosState = initialAgentTodosState;
    cleanups.push(
      client.onAgentTodosUpdate((snapshot) => {
        state = applyAgentTodosSnapshot(state, snapshot);
      }),
    );

    const before = await createMockAgent(client, "#todo plan");
    await waitFor(() => snapshotFor(state, before) !== undefined, "the first daemon's snapshot");
    await client.agent(before).send("#todo advance");
    await waitFor(() => snapshotFor(state, before)?.seq === 2, "seq 2 on the first daemon");

    // Stop the daemon and bring a fresh process up on the same port: its seq counters start over.
    daemon.close();
    await first.close();
    handle = dev(port);
    await listeningPort(handle.httpServer);
    await daemon.connect();

    // The consumer's reconnect step: keep what is rendered, forget the stale seq, refetch.
    state = resetAgentTodosSeq(state);
    expect(snapshotFor(state, before)?.tasks).toHaveLength(4);
    const after = await createMockAgent(client, "#todo plan");
    await waitFor(() => snapshotFor(state, after) !== undefined, "the new daemon's snapshot");
    expect(snapshotFor(state, after)!.seq).toBe(1);

    // The old agent died with the old process; the new daemon answers not_found for it, and the
    // consumer's refetch failure leaves the last known state untouched.
    const stale: AgentTodosSnapshot | undefined = snapshotFor(state, before);
    await expect(client.listAgentTodos(before)).rejects.toMatchObject({ code: "not_found" });
    expect(snapshotFor(state, before)).toBe(stale);
  });
});
