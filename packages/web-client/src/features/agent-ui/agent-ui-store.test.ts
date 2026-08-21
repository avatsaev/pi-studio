import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  ANNOUNCE_CLEAR_DELAY_MS,
  useAnnouncerStore,
} from "@pi-studio-ui/stores/announcer-store.js";
import { useDraftStore } from "@pi-studio-ui/stores/draft-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { tabIds, useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useToastStore } from "@pi-studio-ui/stores/toast-store.js";
import {
  resetAnnouncerStore,
  resetDraftStore,
  resetLayoutStore,
  resetSessionStore,
  resetTabStore,
  resetToastStore,
} from "@pi-studio-ui/test/reset-stores.js";
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

beforeEach(() => {
  // Effect routing (sprint-069/task-006/007/008) now gives `notify`/`set_editor_text`/§ 08
  // transitions real side effects on `useToastStore`/`useDraftStore`/`useTabStore`/
  // `useLayoutStore`/`useAnnouncerStore` — reset every one of them (plus `useSessionStore`, which
  // all of them read) so no test's state leaks into the next one, per this file's own established
  // convention.
  resetSessionStore();
  resetToastStore();
  resetDraftStore();
  resetTabStore();
  resetLayoutStore();
  resetAnnouncerStore();
});

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

describe("agent-ui-store — effects (sprint-069/task-006)", () => {
  it("a single notify request produces exactly one toast — not zero, not two", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "notify",
        expectsResponse: false,
        payload: { message: "Sync complete." },
      }),
    );
    await flush();

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.content).toBe("Chat — Sync complete.");
  });

  it("renders the bare message for the active session, and a session-title locator otherwise", async () => {
    useSessionStore.setState({
      sessions: {
        s1: { id: "s1", agentId: "agent-1", title: "Active chat" } as never,
        s2: { id: "s2", agentId: "agent-2", title: "Background chat" } as never,
      },
      order: ["s1", "s2"],
      activeSessionId: "s1",
    });
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "notify",
        expectsResponse: false,
        payload: { message: "From the active one." },
      }),
    );
    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-2",
        method: "notify",
        expectsResponse: false,
        requestId: "req-bg",
        payload: { message: "From the background one." },
      }),
    );
    await flush();

    const [first, second] = useToastStore.getState().toasts;
    expect(first?.content).toBe("From the active one.");
    expect(second?.content).toBe("Background chat — From the background one.");
  });

  it("orders two notify toasts the same order they were emitted", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({ method: "notify", expectsResponse: false, payload: { message: "first" } }),
    );
    fake.emitUiRequest(
      pendingRequest({
        method: "notify",
        expectsResponse: false,
        requestId: "req-second",
        payload: { message: "second" },
      }),
    );
    await flush();

    expect(useToastStore.getState().toasts.map((t) => t.content)).toEqual([
      "Chat — first",
      "Chat — second",
    ]);
  });

  it("maps level to the toast variant and duration through the real reduce/commit pipeline", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        method: "notify",
        expectsResponse: false,
        payload: { message: "careful", level: "warning" },
      }),
    );
    await flush();

    const toast = useToastStore.getState().toasts[0];
    expect(toast?.variant).toBe("warning");
    expect(toast?.durationMs).toBe(6000);
  });

  it("an error-level notify renders a sticky toast", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        method: "notify",
        expectsResponse: false,
        payload: { message: "broken", level: "error" },
      }),
    );
    await flush();

    const toast = useToastStore.getState().toasts[0];
    expect(toast?.variant).toBe("error");
    expect(toast?.durationMs).toBeNull();
  });

  it("replace_composer_text produces no toast — a known effect kind with no consumer yet", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "draft" },
      }),
    );
    await flush();

    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("with no capability, no controller is ever created and a notify event is a silent no-op", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: false });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        method: "notify",
        expectsResponse: false,
        payload: { message: "should never render" },
      }),
    );
    await flush();

    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

/** Opens a chat tab for `sessionId` in `cwd`, wiring layout state through the real store actions
 *  (`useTabStore.open`) so `isTabVisible`'s pane/workspace checks have something real to read —
 *  never hand-constructed layout state. */
function openChatTab(sessionId: string, cwd: string): void {
  useTabStore.getState().open({
    id: tabIds.chat(sessionId),
    kind: "chat",
    label: sessionId,
    closable: true,
    data: { sessionId },
    workspaceCwd: cwd,
  });
}

describe("agent-ui-store — replace_composer_text (sprint-069/task-007)", () => {
  it("routes to the effect's own session's draft, never whichever composer currently has focus", async () => {
    useSessionStore.setState({
      sessions: {
        s1: { id: "s1", agentId: "agent-1", title: "One", cwd: "/ws" } as never,
        s2: { id: "s2", agentId: "agent-2", title: "Two", cwd: "/ws" } as never,
      },
      order: ["s1", "s2"],
      activeSessionId: null,
    });
    openChatTab("s1", "/ws");
    openChatTab("s2", "/ws"); // opened second, in the same pane — s2 is now the focused/visible tab

    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1", // targets s1, even though s2's composer is the one on screen
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "routed correctly" },
      }),
    );
    await flush();

    expect(useDraftStore.getState().drafts.s1).toBe("routed correctly");
    expect(useDraftStore.getState().drafts.s2).toBeUndefined();
  });

  it("flashes when the target session's composer is on screen", async () => {
    useSessionStore.setState({
      sessions: { s1: { id: "s1", agentId: "agent-1", title: "One", cwd: "/ws" } as never },
      order: ["s1"],
      activeSessionId: null,
    });
    openChatTab("s1", "/ws");

    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "visible replacement" },
      }),
    );
    await flush();

    expect(useDraftStore.getState().pendingFeedback.s1).toEqual({ copy: "filled", flash: true });
  });

  it("queues note-only feedback — never a flash — for a session whose tab is open but not on screen", async () => {
    useSessionStore.setState({
      sessions: {
        s1: { id: "s1", agentId: "agent-1", title: "One", cwd: "/ws" } as never,
        s2: { id: "s2", agentId: "agent-2", title: "Two", cwd: "/ws" } as never,
      },
      order: ["s1", "s2"],
      activeSessionId: null,
    });
    openChatTab("s1", "/ws");
    openChatTab("s2", "/ws"); // s2 now occupies the (only) pane — s1's tab exists but is hidden

    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "background replacement" },
      }),
    );
    await flush();

    expect(useDraftStore.getState().drafts.s1).toBe("background replacement");
    expect(useDraftStore.getState().pendingFeedback.s1).toEqual({ copy: "filled", flash: false });
  });

  it("still applies the text — never lost — for a session with no chat tab open anywhere", async () => {
    useSessionStore.setState({
      sessions: { s1: { id: "s1", agentId: "agent-1", title: "One", cwd: "/ws" } as never },
      order: ["s1"],
      activeSessionId: null,
    });
    // No `openChatTab` call — this session has never had a chat tab opened.

    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "arrives before any composer exists" },
      }),
    );
    await flush();

    expect(useDraftStore.getState().drafts.s1).toBe("arrives before any composer exists");
    expect(useDraftStore.getState().pendingFeedback.s1).toEqual({ copy: "filled", flash: false });
  });

  it("is a defensive no-op for an agentId naming no locally-tracked session — never throws", async () => {
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "unknown-agent",
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "nowhere to go" },
      }),
    );
    await flush(); // would throw here if the lookup miss were not handled defensively

    expect(useDraftStore.getState().drafts).toEqual({});
    expect(useDraftStore.getState().pendingFeedback).toEqual({});
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
describe("agent-ui-store — announcements (sprint-069/task-008)", () => {
  it("a pending question arriving in the active session speaks the prompt", async () => {
    useSessionStore.setState({
      sessions: { s1: { id: "s1", agentId: "agent-1", title: "Active chat" } as never },
      order: ["s1"],
      activeSessionId: "s1",
    });
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "confirm",
        payload: { title: "Allow this extension to modify /etc/hosts?" },
      }),
    );
    await flush();

    expect(useAnnouncerStore.getState()).toEqual({
      message: "A question needs input: Allow this extension to modify /etc/hosts?",
      politeness: "polite",
    });
  });

  it("a pending question arriving in a background session speaks the session-name locator", async () => {
    useSessionStore.setState({
      sessions: {
        s1: { id: "s1", agentId: "agent-1", title: "Active chat" } as never,
        s2: { id: "s2", agentId: "agent-2", title: "Background chat" } as never,
      },
      order: ["s1", "s2"],
      activeSessionId: "s1",
    });
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(pendingRequest({ agentId: "agent-2", method: "confirm" }));
    await flush();

    expect(useAnnouncerStore.getState().message).toBe("A question needs input in Background chat");
  });

  it("a snapshot-recovered pending question (from listAgentUi, not a live event) never announces", async () => {
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

    expect(useAnnouncerStore.getState().message).toBe("");
  });

  it("resolving a pending question speaks the resolution and never echoes an answer value", async () => {
    useSessionStore.setState({
      sessions: { s1: { id: "s1", agentId: "agent-1", title: "skill: connectivity" } as never },
      order: ["s1"],
      activeSessionId: null,
    });
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);
    fake.emitUiRequest(
      pendingRequest({ agentId: "agent-1", requestId: "req-1", method: "select" }),
    );
    await flush();
    // Submit locally first — an `answer` on the resolved entry only ever exists when THIS client
    // is the one that submitted it (`agent-ui-state.ts`'s `reduceUiResolved`).
    void respondToUi("req-1", { value: "sk-live-SECRET-TOKEN" });
    await flush();

    fake.emitUiResolved({
      type: "agent_ui_resolved",
      requestId: "req-1",
      agentId: "agent-1",
      reason: "answered",
    });
    await flush();

    expect(useAnnouncerStore.getState().message).toBe("Answered in skill: connectivity");
  });

  it("clearing the last pending question schedules a silent clear, not an immediate one", async () => {
    useSessionStore.setState({
      sessions: { s1: { id: "s1", agentId: "agent-1", title: "skill: connectivity" } as never },
      order: ["s1"],
      activeSessionId: null,
    });
    vi.useFakeTimers();
    try {
      const fake = makeFakeClient({ extensionUiAvailable: true });
      await connectFake(fake);
      fake.emitUiRequest(
        pendingRequest({ agentId: "agent-1", requestId: "req-1", method: "confirm" }),
      );
      await flush();

      fake.emitUiResolved({
        type: "agent_ui_resolved",
        requestId: "req-1",
        agentId: "agent-1",
        reason: "cancelled",
      });
      await flush();

      expect(useAnnouncerStore.getState().message).toBe("Dismissed in skill: connectivity");
      await vi.advanceTimersByTimeAsync(ANNOUNCE_CLEAR_DELAY_MS);
      expect(useAnnouncerStore.getState().message).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a notify effect also speaks its § 11 announcement, at the level's politeness", async () => {
    useSessionStore.setState({
      sessions: { s1: { id: "s1", agentId: "agent-1", title: "Active chat" } as never },
      order: ["s1"],
      activeSessionId: "s1",
    });
    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "notify",
        expectsResponse: false,
        payload: { message: "Rate limit approaching.", level: "error" },
      }),
    );
    await flush();

    expect(useAnnouncerStore.getState()).toEqual({
      message: "Rate limit approaching.",
      politeness: "assertive",
    });
  });

  it("a background set_editor_text speaks 'Draft replaced in <session>'; a visible one is silent", async () => {
    useSessionStore.setState({
      sessions: {
        s1: { id: "s1", agentId: "agent-1", title: "One", cwd: "/ws" } as never,
        s2: { id: "s2", agentId: "agent-2", title: "Two", cwd: "/ws" } as never,
      },
      order: ["s1", "s2"],
      activeSessionId: null,
    });
    openChatTab("s1", "/ws");
    openChatTab("s2", "/ws"); // s2 occupies the pane — s1 is a background session

    const fake = makeFakeClient({ extensionUiAvailable: true });
    await connectFake(fake);

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-1",
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "background replacement" },
      }),
    );
    await flush();
    expect(useAnnouncerStore.getState().message).toBe("Draft replaced in One");

    fake.emitUiRequest(
      pendingRequest({
        agentId: "agent-2",
        requestId: "req-visible",
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "visible replacement" },
      }),
    );
    await flush();
    // Still the earlier message — the visible case is never announced (the on-screen note is the
    // feedback).
    expect(useAnnouncerStore.getState().message).toBe("Draft replaced in One");
  });
});
