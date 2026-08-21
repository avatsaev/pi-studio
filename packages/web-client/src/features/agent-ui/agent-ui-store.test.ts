import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentUiPendingRequest,
  AgentUiRequest,
  AgentUiResolved,
  AgentUiResponse,
  AgentUiSurface,
} from "@av-pi-studio/protocol";
import type {
  AgentUiEventMeta,
  AgentUiRespondResult,
  ConnectionState,
  PiStudioClient,
} from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import {
  respondToUi,
  selectAgentUiPending,
  selectAgentUiResolved,
  useAgentUiStore,
} from "./agent-ui-store.js";

/**
 * Minimal stub of the `PiStudioClient` surface `createAgentUiController` touches — the shape the
 * SDK's own `agent-ui-controller.test.ts` establishes (`onAgentUiRequest`/`onAgentUiResolved`,
 * `connection.onSessionMessage`/`onStateChange`, `listAgentUi`, `respondToUi`,
 * `extensionUiAvailable`) — plus a settable `connection.state`, since this store (unlike the
 * controller itself) gates controller *creation* on the connection reaching `"open"`.
 */
interface FakeClient {
  client: PiStudioClient;
  setConnState(next: ConnectionState): void;
  setExtensionUiAvailable(v: boolean): void;
  setListResult(r: { pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] }): void;
  emitUiRequest(event: AgentUiRequest, meta?: AgentUiEventMeta): void;
  emitUiResolved(event: AgentUiResolved): void;
  readonly listCalls: number;
  readonly respondCalls: Array<[string, AgentUiResponse]>;
}

function makeFakeClient(opts: { extensionUiAvailable?: boolean } = {}): FakeClient {
  let state: ConnectionState = "idle";
  let extAvailable = opts.extensionUiAvailable ?? true;
  const stateHandlers = new Set<(s: ConnectionState) => void>();
  const uiRequestHandlers = new Set<(event: AgentUiRequest, meta: AgentUiEventMeta) => void>();
  const uiResolvedHandlers = new Set<(event: AgentUiResolved) => void>();
  let listResult: { pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] } = {
    pending: [],
    surfaces: [],
  };
  let listCalls = 0;
  const respondCalls: Array<[string, AgentUiResponse]> = [];

  const client = {
    connection: {
      get state() {
        return state;
      },
      onStateChange(cb: (s: ConnectionState) => void) {
        stateHandlers.add(cb);
        return () => stateHandlers.delete(cb);
      },
      onSessionMessage() {
        return () => {};
      },
    },
    extensionUiAvailable: () => extAvailable,
    onAgentUiRequest(cb: (event: AgentUiRequest, meta: AgentUiEventMeta) => void) {
      uiRequestHandlers.add(cb);
      return () => uiRequestHandlers.delete(cb);
    },
    onAgentUiResolved(cb: (event: AgentUiResolved) => void) {
      uiResolvedHandlers.add(cb);
      return () => uiResolvedHandlers.delete(cb);
    },
    async listAgentUi() {
      listCalls++;
      return listResult;
    },
    async respondToUi(
      uiRequestId: string,
      response: AgentUiResponse,
    ): Promise<AgentUiRespondResult> {
      respondCalls.push([uiRequestId, response]);
      return { ok: true };
    },
  } as unknown as PiStudioClient;

  return {
    client,
    setConnState(next: ConnectionState) {
      state = next;
      // Snapshot before dispatch: creating the controller synchronously inside a handler
      // registers a NEW `onStateChange` listener on this same Set (the controller's own resync
      // wiring) — a live (unsnapshotted) `for...of` over a `Set` visits entries inserted during
      // iteration, which would fire that brand-new listener a second time in this very dispatch.
      for (const h of Array.from(stateHandlers)) h(next);
    },
    setExtensionUiAvailable(v: boolean) {
      extAvailable = v;
    },
    setListResult(r: { pending: AgentUiPendingRequest[]; surfaces: AgentUiSurface[] }) {
      listResult = r;
    },
    emitUiRequest(event: AgentUiRequest, meta: AgentUiEventMeta = { receivedAt: Date.now() }) {
      for (const h of Array.from(uiRequestHandlers)) h(event, meta);
    },
    emitUiResolved(event: AgentUiResolved) {
      for (const h of Array.from(uiResolvedHandlers)) h(event);
    },
    get listCalls() {
      return listCalls;
    },
    get respondCalls() {
      return respondCalls;
    },
  };
}

// Deterministic microtask drain — the controller's resync/respond paths are promise-chained.
async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function pendingRequest(overrides: Partial<AgentUiRequest> = {}): AgentUiRequest {
  return {
    type: "agent_ui_request",
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    agentId: "agent-1",
    method: "confirm",
    expectsResponse: true,
    payload: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Connects `fake` through the real `useConnectionStore` and lets its connection reach "open". */
async function connectFake(fake: FakeClient): Promise<void> {
  useConnectionStore.setState({ client: fake.client });
  fake.setConnState("open");
  await flush();
}

afterEach(async () => {
  // Drive back to "no client" so each test starts from a real identity change (`attach` is a
  // no-op on a redundant same-identity call) and the previous controller is fully disposed.
  useConnectionStore.setState({ client: null });
  await flush();
});

describe("agent-ui-store — lifecycle", () => {
  it("a capability-carrying, open client creates exactly one controller and rebuilds pending from the snapshot", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    fake.setListResult({
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
    await connectFake(fake);

    expect(useAgentUiStore.getState().controller).not.toBeNull();
    expect(fake.listCalls).toBe(1);
    const pending = selectAgentUiPending(useAgentUiStore.getState(), "agent-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.requestId).toBe("req-1");
  });

  it("with a capability-less server_info, no controller is ever created and no agent_ui_* RPC is sent", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: false });
    await connectFake(fake);

    expect(useAgentUiStore.getState().controller).toBeNull();
    expect(fake.listCalls).toBe(0);
    expect(selectAgentUiPending(useAgentUiStore.getState(), "agent-1")).toEqual([]);
  });

  it("disconnecting then reconnecting the SAME client does not recreate the controller, and rehydrates via its own resync", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    const controllerBeforeDrop = useAgentUiStore.getState().controller;
    expect(controllerBeforeDrop).not.toBeNull();

    fake.setConnState("closed");
    await flush();
    expect(useAgentUiStore.getState().controller).toBe(controllerBeforeDrop); // never torn down

    fake.setListResult({
      pending: [
        {
          requestId: "req-2",
          agentId: "agent-1",
          method: "select",
          expectsResponse: true,
          payload: {},
          createdAt: 2,
        },
      ],
      surfaces: [],
    });
    fake.setConnState("open");
    await flush();

    expect(useAgentUiStore.getState().controller).toBe(controllerBeforeDrop);
    expect(selectAgentUiPending(useAgentUiStore.getState(), "agent-1")).toHaveLength(1);
  });

  it("switching to a different client tears down the old controller and leaves no residual state", async () => {
    const fakeA = makeFakeClient({ extensionUiAvailable: true });
    fakeA.setListResult({
      pending: [
        {
          requestId: "req-a",
          agentId: "agent-1",
          method: "confirm",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await connectFake(fakeA);
    expect(selectAgentUiPending(useAgentUiStore.getState(), "agent-1")).toHaveLength(1);

    const fakeB = makeFakeClient({ extensionUiAvailable: true });
    useConnectionStore.setState({ client: fakeB.client });
    fakeB.setConnState("open");
    await flush();

    // Fresh controller against fakeB's (empty) snapshot — nothing from fakeA survives.
    expect(selectAgentUiPending(useAgentUiStore.getState(), "agent-1")).toEqual([]);
  });
});

describe("agent-ui-store — selectors", () => {
  it("useAgentUiPending-equivalent selector returns a stable empty value with no controller", () => {
    const a = selectAgentUiPending(useAgentUiStore.getState(), "agent-1");
    const b = selectAgentUiPending(useAgentUiStore.getState(), "agent-1");
    expect(a).toEqual([]);
    expect(a).toBe(b); // same shared EMPTY_PENDING reference, not merely equal content
  });

  it("a dialog arriving for agent A does not change the selector value for agent B", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    const before = selectAgentUiPending(useAgentUiStore.getState(), "agent-B");
    fake.emitUiRequest(pendingRequest({ agentId: "agent-A", requestId: "req-a" }));
    await flush();
    const after = selectAgentUiPending(useAgentUiStore.getState(), "agent-B");

    expect(after).toBe(before); // referentially stable — agent-B's slice never changed
  });

  it("selector output is referentially stable across an unrelated store update for the SAME agent", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    fake.emitUiRequest(pendingRequest({ agentId: "agent-1", requestId: "req-1" }));
    await flush();

    const first = selectAgentUiPending(useAgentUiStore.getState(), "agent-1");
    // Trigger another commit (a second, unrelated agent's transient) without touching agent-1.
    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-2",
        method: "notify",
        expectsResponse: false,
        requestId: "req-x",
      }),
    );
    await flush();
    const second = selectAgentUiPending(useAgentUiStore.getState(), "agent-1");

    expect(second).toBe(first);
  });

  it("selectAgentUiResolved carries a dialog into resolved state once agent_ui_resolved arrives", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    fake.emitUiRequest(
      pendingRequest({ agentId: "agent-1", requestId: "req-1", method: "select" }),
    );
    await flush();
    expect(selectAgentUiPending(useAgentUiStore.getState(), "agent-1")).toHaveLength(1);

    fake.emitUiResolved({
      type: "agent_ui_resolved",
      requestId: "req-1",
      agentId: "agent-1",
      reason: "answered",
    });
    await flush();

    expect(selectAgentUiPending(useAgentUiStore.getState(), "agent-1")).toEqual([]);
    const resolved = selectAgentUiResolved(useAgentUiStore.getState(), "agent-1");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.requestId).toBe("req-1");
  });
});

describe("agent-ui-store — respondToUi", () => {
  it("forwards to the controller and returns the SDK's AgentUiRespondResult unchanged", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    fake.setListResult({
      pending: [
        {
          requestId: "req-1",
          agentId: "agent-1",
          method: "select",
          expectsResponse: true,
          payload: {},
          createdAt: 1,
        },
      ],
      surfaces: [],
    });
    await connectFake(fake);

    const result = await respondToUi("req-1", { value: "Allow" });
    expect(result).toEqual({ ok: true });
    expect(fake.respondCalls).toEqual([["req-1", { value: "Allow" }]]);
  });

  it("resolves ok:false, reason:unsupported with no RPC when no controller exists", async () => {
    const result = await respondToUi("req-1", { value: "Allow" });
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });
});
