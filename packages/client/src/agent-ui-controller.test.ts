import { describe, expect, it, vi } from "vitest";

import { createAgentUiController } from "./agent-ui-controller.js";
import type { AgentUiEffect, AgentUiState } from "./agent-ui-state.js";
import { makeFacade } from "./test-support/scripted-daemon.js";

// Deterministic microtask drain — no real wall-clock wait. The scripted daemon delivers every
// message via `queueMicrotask`, and the SDK's/controller's own handling is synchronous once a
// message is delivered; a handful of chained ticks comfortably drains any nesting this produces.
async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

let seq = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++seq}`;
}

function dialogPush(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "agent_ui_request",
    requestId: nextId("req"),
    agentId: "agent-1",
    method: "confirm",
    expectsResponse: true,
    payload: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

function surfacePush(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "agent_ui_request",
    requestId: nextId("req"),
    agentId: "agent-1",
    method: "setStatus",
    expectsResponse: false,
    surfaceKey: "status",
    payload: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

function transientPush(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "agent_ui_request",
    requestId: nextId("req"),
    agentId: "agent-1",
    method: "notify",
    expectsResponse: false,
    payload: { message: "hi", level: "info" },
    createdAt: Date.now(),
    ...overrides,
  };
}

function findListRequest(sent: Array<Record<string, unknown>>, index = 0): Record<string, unknown> {
  const requests = sent.filter((m) => m.type === "agent_ui_list_request");
  const req = requests[index];
  if (!req) throw new Error(`no agent_ui_list_request at index ${index} (sent ${requests.length})`);
  return req;
}

function replyList(
  push: (m: Record<string, unknown>) => void,
  requestId: unknown,
  payload: { ok: boolean; pending?: unknown[]; surfaces?: unknown[]; error?: string },
): void {
  push({ type: "agent_ui_list_response", requestId, payload });
}

describe("agent-ui-controller — subscribe-then-list rehydration", () => {
  it("an agent_ui_request pushed while listAgentUi is in flight is present exactly once afterwards, sourced from the snapshot (not a duplicated replay)", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();

    const listReq = findListRequest(fake.sent);
    fake.push(dialogPush({ requestId: "req-live" }));
    await flush();
    // A faithful daemon's list response, composed after this event on the same ordered socket,
    // already reflects it — the scripted reply mirrors that invariant.
    replyList(fake.push, listReq.requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-live",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    const entry = controller.getState().pending["req-live"];
    expect(entry).toBeDefined();
    expect(Object.keys(controller.getState().pending)).toHaveLength(1);
    // Sourced from the snapshot rebuild, not a replayed live upsert (which would carry a local
    // receivedAt) — proves the queued dialog was discarded, not duplicated on top of the snapshot.
    expect(entry?.receivedAt).toBeUndefined();
    controller.dispose();
  });

  it("a queued surface upsert delivered during an in-flight listAgentUi is discarded, never overwriting the snapshot's value", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    // Seed the initial resync with an existing surface for (agent-1, status).
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [],
      surfaces: [
        {
          agentId: "agent-1",
          method: "setStatus",
          surfaceKey: "status",
          payload: { v: "seed" },
          updatedAt: 1,
        },
      ],
    });
    await flush();

    void controller.resync();
    await flush();
    const secondListReq = findListRequest(fake.sent, 1);
    // A live surface update for the SAME key arrives while this second listAgentUi is in flight.
    fake.push(surfacePush({ payload: { v: "queued-during-resync" } }));
    await flush();
    replyList(fake.push, secondListReq.requestId, {
      ok: true,
      pending: [],
      surfaces: [
        {
          agentId: "agent-1",
          method: "setStatus",
          surfaceKey: "status",
          payload: { v: "authoritative" },
          updatedAt: 2,
        },
      ],
    });
    await flush();

    const surfaces = Object.values(controller.getState().surfaces);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.payload).toEqual({ v: "authoritative" });
    controller.dispose();
  });

  it("a queued transient delivered during an in-flight listAgentUi emits its effect exactly once, after the snapshot commits", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const allEffects: AgentUiEffect[] = [];
    const controller = createAgentUiController(client);
    controller.subscribe((_state, effects) => allEffects.push(...effects));
    await flush();

    fake.push(transientPush());
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [],
      surfaces: [],
    });
    await flush();

    const notifyEffects = allEffects.filter((e) => e.type === "notify");
    expect(notifyEffects).toHaveLength(1);
    controller.dispose();
  });
});

describe("agent-ui-controller — reconnect", () => {
  it("drop() marks pending answerable:false; a subsequent open triggers resync automatically, no consumer call", async () => {
    const { client, daemon, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();
    expect(controller.getState().pending["req-1"]?.answerable).toBe(true);

    fake.drop();
    await flush();
    expect(controller.getState().pending["req-1"]?.answerable).toBe(false);

    await daemon.connect();
    await flush();
    const reconnectListReq = findListRequest(fake.sent, 1);
    replyList(fake.push, reconnectListReq.requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    expect(controller.getState().pending["req-1"]?.answerable).toBe(true);
    controller.dispose();
  });

  it("with features.extensionUi absent, no agent_ui_list_request is ever sent and state stays empty; a reconnect with the flag now present syncs", async () => {
    const { client, daemon, fake } = await makeFacade({ features: {} });
    const controller = createAgentUiController(client);
    await flush();

    expect(fake.sent.filter((m) => m.type === "agent_ui_list_request")).toHaveLength(0);
    expect(controller.getState()).toEqual({ pending: {}, surfaces: {}, resolved: {} });

    fake.drop();
    await flush();
    fake.features.extensionUi = true;
    await daemon.connect();
    await flush();

    const listReq = findListRequest(fake.sent);
    replyList(fake.push, listReq.requestId, { ok: true, pending: [], surfaces: [] });
    await flush();

    expect(fake.sent.filter((m) => m.type === "agent_ui_list_request")).toHaveLength(1);
    controller.dispose();
  });

  it("construction against an already-open client does not produce a duplicate initial snapshot request", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [],
      surfaces: [],
    });
    await flush();

    expect(fake.sent.filter((m) => m.type === "agent_ui_list_request")).toHaveLength(1);
    controller.dispose();
  });
});

describe("agent-ui-controller — overlapping resync (generation guard)", () => {
  it("commits only the newer snapshot; the superseded response never wins regardless of reply order", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [],
      surfaces: [],
    });
    await flush();

    void controller.resync(); // call A
    await flush();
    const reqA = findListRequest(fake.sent, 1);
    void controller.resync(); // call B, overlapping A
    await flush();
    const reqB = findListRequest(fake.sent, 2);
    expect(reqA.requestId).not.toBe(reqB.requestId);

    // A resolves first (chronological reply order); its snapshot must still lose to B's.
    replyList(fake.push, reqA.requestId, {
      ok: true,
      pending: [
        {
          requestId: "stale-a",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();
    replyList(fake.push, reqB.requestId, {
      ok: true,
      pending: [
        {
          requestId: "fresh-b",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 2,
        },
      ],
      surfaces: [],
    });
    await flush();

    expect(controller.getState().pending["stale-a"]).toBeUndefined();
    expect(controller.getState().pending["fresh-b"]).toBeDefined();
    controller.dispose();
  });
});

describe("agent-ui-controller — failed sync", () => {
  it("a rejected listAgentUi leaves prior state intact, reports the error, and a later resync() still succeeds", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "seed",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    void controller.resync();
    await flush();
    replyList(fake.push, findListRequest(fake.sent, 1).requestId, { ok: false, error: "boom" });
    await flush();

    expect(errorSpy).toHaveBeenCalled();
    expect(controller.getState().pending.seed).toBeDefined();

    void controller.resync();
    await flush();
    replyList(fake.push, findListRequest(fake.sent, 2).requestId, {
      ok: true,
      pending: [
        {
          requestId: "seed2",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 2,
        },
      ],
      surfaces: [],
    });
    await flush();

    expect(controller.getState().pending.seed2).toBeDefined();
    expect(controller.getState().pending.seed).toBeUndefined();
    controller.dispose();
    errorSpy.mockRestore();
  });
});

describe("agent-ui-controller — respond", () => {
  it("returns the SDK's AgentUiRespondResult unchanged and performs no optimistic state change", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    const resultPromise = controller.respond("req-1", { confirmed: true });
    await flush();
    // No optimistic dismissal — the entry survives until a real agent_ui_resolved arrives.
    expect(controller.getState().pending["req-1"]).toBeDefined();

    const respondReq = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    expect(respondReq?.uiRequestId).toBe("req-1");
    fake.push({
      type: "agent_ui_respond_response",
      requestId: respondReq?.requestId,
      payload: { ok: true },
    });
    await expect(resultPromise).resolves.toEqual({ ok: true });
    expect(controller.getState().pending["req-1"]).toBeDefined();

    fake.push({
      type: "agent_ui_resolved",
      requestId: "req-1",
      agentId: "agent-1",
      reason: "answered",
    });
    await flush();
    expect(controller.getState().pending["req-1"]).toBeUndefined();
    controller.dispose();
  });

  it("dispatches respond_sent immediately (submitting: true, before the RPC settles), and the resolved entry carries the confirm answer", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    const resultPromise = controller.respond("req-1", { confirmed: true });
    // Before the RPC round-trips at all: submitting is already true, synchronously.
    expect(controller.getState().pending["req-1"]?.submitting).toBe(true);
    await flush();

    const respondReq = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    fake.push({
      type: "agent_ui_respond_response",
      requestId: respondReq?.requestId,
      payload: { ok: true },
    });
    await expect(resultPromise).resolves.toEqual({ ok: true });
    // A successful RPC does not itself clear submitting — only a real agent_ui_resolved does.
    expect(controller.getState().pending["req-1"]?.submitting).toBe(true);

    fake.push({
      type: "agent_ui_resolved",
      requestId: "req-1",
      agentId: "agent-1",
      reason: "answered",
    });
    await flush();
    expect(controller.getState().pending["req-1"]).toBeUndefined();
    expect(controller.getState().resolved["req-1"]?.answer).toEqual({ confirmed: true });
    controller.dispose();
  });

  it("a domain failure (ok: false) dispatches respond_failed, clearing submitting, and still returns the result rather than throwing", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    const resultPromise = controller.respond("req-1", { confirmed: true });
    await flush();
    expect(controller.getState().pending["req-1"]?.submitting).toBe(true);

    const respondReq = fake.sent.find((m) => m.type === "agent_ui_respond_request");
    fake.push({
      type: "agent_ui_respond_response",
      requestId: respondReq?.requestId,
      payload: { ok: false, error: "not_found" },
    });
    await expect(resultPromise).resolves.toEqual({ ok: false, reason: "not_found" });
    // Cleared, not thrown — the entry stays pending (another client may still answer it).
    expect(controller.getState().pending["req-1"]?.submitting).toBeUndefined();
    expect(controller.getState().pending["req-1"]).toBeDefined();
    controller.dispose();
  });
});

describe("agent-ui-controller — agent-lifecycle pruning", () => {
  it("a real agent_archived message dispatches agent_removed; repeating is a no-op; other agents untouched", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-a1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
        {
          requestId: "req-a2",
          agentId: "agent-2",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [
        {
          agentId: "agent-1",
          method: "setStatus",
          surfaceKey: "status",
          payload: {},
          updatedAt: 1,
        },
      ],
    });
    await flush();

    fake.push({ type: "agent_archived", agentId: "agent-1", archivedAt: new Date().toISOString() });
    await flush();
    expect(controller.getState().pending["req-a1"]).toBeUndefined();
    expect(Object.keys(controller.getState().surfaces)).toHaveLength(0);
    expect(controller.getState().pending["req-a2"]).toBeDefined();

    const afterFirstPrune = controller.getState();
    fake.push({ type: "agent_archived", agentId: "agent-1", archivedAt: new Date().toISOString() });
    await flush();
    expect(controller.getState().pending).toEqual(afterFirstPrune.pending);
    expect(controller.getState().surfaces).toEqual(afterFirstPrune.surfaces);
    controller.dispose();
  });

  it("a real agent_deleted message dispatches agent_removed", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-a1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    fake.push({ type: "agent_deleted", agentId: "agent-1" });
    await flush();
    expect(controller.getState().pending["req-a1"]).toBeUndefined();
    controller.dispose();
  });

  it("an agent_update message for the same agent prunes nothing (regression lock)", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-a1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    fake.push({ type: "agent_update", agentId: "agent-1", status: "idle" });
    await flush();
    expect(controller.getState().pending["req-a1"]).toBeDefined();
    controller.dispose();
  });
});

describe("agent-ui-controller — unknown fire-and-forget methods", () => {
  it("reports via onUnknownMethod once per method, even after three deliveries; a different unknown method reports separately", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const onUnknownMethod = vi.fn();
    const controller = createAgentUiController(client, { onUnknownMethod });
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [],
      surfaces: [],
    });
    await flush();

    fake.push(transientPush({ method: "future_x" }));
    fake.push(transientPush({ method: "future_x" }));
    fake.push(transientPush({ method: "future_x" }));
    await flush();
    expect(onUnknownMethod).toHaveBeenCalledTimes(1);
    expect(onUnknownMethod).toHaveBeenCalledWith("future_x");

    fake.push(transientPush({ method: "future_y" }));
    await flush();
    expect(onUnknownMethod).toHaveBeenCalledTimes(2);
    expect(onUnknownMethod).toHaveBeenCalledWith("future_y");
    controller.dispose();
  });
});

describe("agent-ui-controller — subscribe", () => {
  it("listeners receive only their own transition's effects, never a re-delivery of an earlier one, and stop after unsubscribe", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [],
      surfaces: [],
    });
    await flush();

    const callsA: AgentUiEffect[][] = [];
    const unsubA = controller.subscribe((_s, effects) => callsA.push(effects));

    fake.push(transientPush());
    await flush();
    expect(callsA).toHaveLength(1);
    expect(callsA[0]).toEqual([
      { type: "notify", agentId: "agent-1", message: "hi", level: "info" },
    ]);

    const callsB: AgentUiEffect[][] = [];
    controller.subscribe((_s, effects) => callsB.push(effects));

    fake.push(dialogPush());
    await flush();
    // B never sees the earlier notify — only the effects of the transition it was present for.
    expect(callsB).toHaveLength(1);
    expect(callsB[0]).toEqual([]);
    expect(callsA).toHaveLength(2);

    unsubA();
    fake.push(dialogPush());
    await flush();
    expect(callsA).toHaveLength(2); // A stopped receiving
    expect(callsB).toHaveLength(2); // B keeps receiving
    controller.dispose();
  });
});

describe("agent-ui-controller — dispose", () => {
  it("detaches everything: later pushes, state transitions and agent_updates change nothing and throw nothing", async () => {
    const { client, fake } = await makeFacade({ features: { extensionUi: true } });
    const controller = createAgentUiController(client);
    await flush();
    replyList(fake.push, findListRequest(fake.sent).requestId, {
      ok: true,
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await flush();

    controller.dispose();
    const before: AgentUiState = controller.getState();

    expect(() => {
      fake.push(dialogPush());
      fake.push({
        type: "agent_archived",
        agentId: "agent-1",
        archivedAt: new Date().toISOString(),
      });
      fake.push({ type: "agent_update", agentId: "agent-1", status: "idle" });
      fake.drop();
    }).not.toThrow();
    await flush();

    expect(controller.getState()).toEqual(before);
  });
});
