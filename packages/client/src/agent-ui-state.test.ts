import type {
  AgentUiPendingRequest,
  AgentUiRequest,
  AgentUiResolved,
  AgentUiSurface,
} from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import {
  type AgentUiEffect,
  type AgentUiState,
  initialAgentUiState,
  pendingByAgent,
  pendingForAgent,
  reduce,
  remainingMs,
  RESOLVED_HISTORY_LIMIT,
  resolvedForAgent,
  surfaceMapKey,
  surfacesForAgent,
} from "./agent-ui-state.js";
import type { AgentUiEventMeta } from "./pistudio-client.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<AgentUiRequest> = {}): AgentUiRequest {
  return {
    type: "agent_ui_request",
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    expectsResponse: true,
    payload: {},
    createdAt: 1000,
    ...overrides,
  };
}

function makeResolved(overrides: Partial<AgentUiResolved> = {}): AgentUiResolved {
  return {
    type: "agent_ui_resolved",
    requestId: "req-1",
    agentId: "agent-1",
    reason: "answered",
    ...overrides,
  };
}

function makeMeta(receivedAt = 1000): AgentUiEventMeta {
  return { receivedAt };
}

function makePendingRequest(overrides: Partial<AgentUiPendingRequest> = {}): AgentUiPendingRequest {
  return {
    requestId: "req-1",
    agentId: "agent-1",
    method: "confirm",
    expectsResponse: true,
    payload: {},
    createdAt: 1000,
    ...overrides,
  };
}

function makeSurface(overrides: Partial<AgentUiSurface> = {}): AgentUiSurface {
  return {
    agentId: "agent-1",
    method: "setStatus",
    surfaceKey: "status",
    payload: {},
    updatedAt: 1000,
    ...overrides,
  };
}

/** Deep-freezes a plain object graph so an accidental mutation throws under strict mode instead of
 *  silently succeeding — the enforcement mechanism for "every reducer call leaves its input untouched". */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Merges one agent's pending + resolved dialogs by `createdAt`, the shape the sibling UI scope
 *  renders — used to assert a card's list index is stable across resolution. */
function mergePendingAndResolved(state: AgentUiState, agentId: string): string[] {
  return [...pendingForAgent(state, agentId), ...resolvedForAgent(state, agentId)]
    .toSorted((a, b) => Number(a.createdAt) - Number(b.createdAt))
    .map((e) => e.requestId);
}

// ─── Routing taxonomy (all nine documented Pi methods + unknowns) ───────────

describe("agent-ui-state — routing taxonomy", () => {
  const dialogMethods = ["select", "confirm", "input", "editor"];
  const surfaceMethods = ["setStatus", "setWidget", "setTitle"];

  it.each(dialogMethods)("%s (expectsResponse: true) routes to a pending dialog", (method) => {
    const { state, effects } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method, expectsResponse: true }),
      meta: makeMeta(),
    });
    expect(state.pending["req-1"]?.method).toBe(method);
    expect(Object.keys(state.surfaces)).toHaveLength(0);
    expect(effects).toEqual([]);
  });

  it.each(surfaceMethods)(
    "%s (surfaceKey set, expectsResponse: false) routes to a surface upsert",
    (method) => {
      const { state, effects } = reduce(initialAgentUiState, {
        type: "ui_request",
        event: makeRequest({ method, expectsResponse: false, surfaceKey: "sk", payload: { v: 1 } }),
        meta: makeMeta(),
      });
      expect(Object.keys(state.pending)).toHaveLength(0);
      const entry = state.surfaces[surfaceMapKey("agent-1", "sk")];
      expect(entry?.method).toBe(method);
      expect(entry?.payload).toEqual({ v: 1 });
      expect(effects).toEqual([]);
    },
  );

  it("notify (no surfaceKey, expectsResponse: false) routes to a transient effect, no state change", () => {
    const { state, effects } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({
        method: "notify",
        expectsResponse: false,
        payload: { message: "hi", level: "info" },
      }),
      meta: makeMeta(),
    });
    expect(state).toBe(initialAgentUiState);
    expect(effects).toEqual([{ type: "notify", agentId: "agent-1", message: "hi", level: "info" }]);
  });

  it("set_editor_text (no surfaceKey, expectsResponse: false) routes to a transient effect, no state change", () => {
    const { state, effects } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "hello" },
      }),
      meta: makeMeta(),
    });
    expect(state).toBe(initialAgentUiState);
    expect(effects).toEqual([{ type: "replace_composer_text", agentId: "agent-1", text: "hello" }]);
  });

  it("routing is driven only by expectsResponse/surfaceKey/removed — never by a method table", () => {
    // A made-up method with expectsResponse:true still lands as a dialog; the same made-up method
    // with surfaceKey set still lands as a surface; the ladder has no opinion on the string itself.
    const dialog = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "brand_new_method", expectsResponse: true }),
      meta: makeMeta(),
    });
    expect(dialog.state.pending["req-1"]?.method).toBe("brand_new_method");

    const surface = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "brand_new_method", expectsResponse: false, surfaceKey: "sk" }),
      meta: makeMeta(),
    });
    expect(surface.state.surfaces[surfaceMapKey("agent-1", "sk")]?.method).toBe("brand_new_method");
  });
});

// ─── Unknown methods ──────────────────────────────────────────────────────────

describe("agent-ui-state — unknown methods", () => {
  it("an unknown dialog method still enters pending, method stored verbatim, no unknown flag", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "future_dialog", expectsResponse: true }),
      meta: makeMeta(),
    });
    const entry = state.pending["req-1"];
    expect(entry?.method).toBe("future_dialog");
    expect(entry).not.toHaveProperty("unknown");
    expect(entry).not.toHaveProperty("fallback");
  });

  it("an unknown fire-and-forget method changes no state and returns zero effects", () => {
    const { state, effects } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "future_transient", expectsResponse: false }),
      meta: makeMeta(),
    });
    expect(state).toBe(initialAgentUiState);
    expect(effects).toEqual([]);
  });
});

// ─── Surfaces: composite keying, clear-by-omission, last-write-wins ─────────

describe("agent-ui-state — surfaces", () => {
  it("two different agents may hold the same surfaceKey without collision; an upsert to one leaves the other untouched", () => {
    let state = initialAgentUiState;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-1",
        surfaceKey: "status",
        expectsResponse: false,
        payload: { v: "a" },
      }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-2",
        requestId: "req-2",
        surfaceKey: "status",
        expectsResponse: false,
        payload: { v: "b" },
      }),
      meta: makeMeta(),
    }).state;
    expect(state.surfaces[surfaceMapKey("agent-1", "status")]?.payload).toEqual({ v: "a" });
    expect(state.surfaces[surfaceMapKey("agent-2", "status")]?.payload).toEqual({ v: "b" });

    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-1",
        requestId: "req-3",
        surfaceKey: "status",
        expectsResponse: false,
        payload: { v: "a2" },
      }),
      meta: makeMeta(),
    }).state;
    expect(state.surfaces[surfaceMapKey("agent-1", "status")]?.payload).toEqual({ v: "a2" });
    expect(state.surfaces[surfaceMapKey("agent-2", "status")]?.payload).toEqual({ v: "b" });
  });

  it("removed: true for a surfaceKey never seen is a no-op; upsert-then-clear leaves no surface", () => {
    const noop = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ surfaceKey: "never-seen", removed: true, expectsResponse: false }),
      meta: makeMeta(),
    });
    expect(noop.state).toBe(initialAgentUiState);

    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ surfaceKey: "status", expectsResponse: false, payload: { v: 1 } }),
      meta: makeMeta(),
    }).state;
    expect(Object.keys(state.surfaces)).toHaveLength(1);
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        requestId: "req-2",
        surfaceKey: "status",
        removed: true,
        expectsResponse: false,
      }),
      meta: makeMeta(),
    }).state;
    expect(Object.keys(state.surfaces)).toHaveLength(0);
  });

  it("a later surface upsert replaces an earlier one for the same (agentId, surfaceKey) even with a different requestId", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({
        requestId: "req-a",
        surfaceKey: "status",
        expectsResponse: false,
        payload: { v: 1 },
      }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        requestId: "req-b",
        surfaceKey: "status",
        expectsResponse: false,
        payload: { v: 2 },
      }),
      meta: makeMeta(),
    }).state;
    expect(Object.keys(state.surfaces)).toHaveLength(1);
    expect(state.surfaces[surfaceMapKey("agent-1", "status")]?.payload).toEqual({ v: 2 });
  });
});

// ─── ui_resolved ──────────────────────────────────────────────────────────────

describe("agent-ui-state — ui_resolved", () => {
  it("resolves a known pending dialog", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, { type: "ui_resolved", event: makeResolved() }).state;
    expect(state.pending["req-1"]).toBeUndefined();
  });

  it("an unknown requestId returns state unchanged and does not throw", () => {
    expect(() =>
      reduce(initialAgentUiState, { type: "ui_resolved", event: makeResolved() }),
    ).not.toThrow();
    const { state } = reduce(initialAgentUiState, { type: "ui_resolved", event: makeResolved() });
    expect(state).toBe(initialAgentUiState);
  });
});

// ─── snapshot: wholesale replacement ──────────────────────────────────────────

describe("agent-ui-state — snapshot", () => {
  it("replaces pending/surfaces wholesale: an entry present in state but absent from the snapshot is gone", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ requestId: "stale", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "snapshot",
      pending: [makePendingRequest({ requestId: "fresh" })],
      surfaces: [],
    }).state;
    expect(state.pending.stale).toBeUndefined();
    expect(state.pending.fresh).toBeDefined();
  });

  it("a surface whose snapshot payload is older than a pre-existing one still wins (no newest-wins comparison)", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ surfaceKey: "status", expectsResponse: false, payload: { v: "newer" } }),
      meta: makeMeta(5000),
    }).state;
    state = reduce(state, {
      type: "snapshot",
      pending: [],
      surfaces: [makeSurface({ payload: { v: "older-snapshot" }, updatedAt: 1000 })],
    }).state;
    expect(state.surfaces[surfaceMapKey("agent-1", "status")]?.payload).toEqual({
      v: "older-snapshot",
    });
  });

  it("snapshot-rebuilt pending entries have answerable: true and no receivedAt", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "snapshot",
      pending: [makePendingRequest()],
      surfaces: [],
    });
    expect(state.pending["req-1"]?.answerable).toBe(true);
    expect(state.pending["req-1"]?.receivedAt).toBeUndefined();
  });
});

// ─── disconnected / reconnect round-trip ──────────────────────────────────────

describe("agent-ui-state — disconnected", () => {
  it("marks every pending entry unanswerable without removing anything; a following snapshot restores answerable: true", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, { type: "disconnected" }).state;
    expect(state.pending["req-1"]?.answerable).toBe(false);
    expect(Object.keys(state.pending)).toHaveLength(1);

    // The round-trip: this is the one-way-door regression this test exists to lock.
    state = reduce(state, {
      type: "snapshot",
      pending: [makePendingRequest()],
      surfaces: [],
    }).state;
    expect(state.pending["req-1"]?.answerable).toBe(true);
  });
});

// ─── agent_removed ────────────────────────────────────────────────────────────

describe("agent-ui-state — agent_removed", () => {
  it("drops that agent's surfaces and pending entries, leaving other agents' state untouched", () => {
    let state = initialAgentUiState;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ agentId: "agent-1", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-1",
        requestId: "req-2",
        surfaceKey: "status",
        expectsResponse: false,
      }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ agentId: "agent-2", requestId: "req-3", expectsResponse: true }),
      meta: makeMeta(),
    }).state;

    state = reduce(state, { type: "agent_removed", agentId: "agent-1" }).state;

    expect(state.pending["req-1"]).toBeUndefined();
    expect(state.surfaces[surfaceMapKey("agent-1", "status")]).toBeUndefined();
    expect(state.pending["req-3"]).toBeDefined();
  });
});

// ─── Transient effect construction ───────────────────────────────────────────

describe("agent-ui-state — transient effects", () => {
  it("set_editor_text produces exactly one replace_composer_text carrying { agentId, text }", () => {
    const { effects } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({
        method: "set_editor_text",
        expectsResponse: false,
        payload: { text: "paste me" },
      }),
      meta: makeMeta(),
    });
    const expected: AgentUiEffect[] = [
      { type: "replace_composer_text", agentId: "agent-1", text: "paste me" },
    ];
    expect(effects).toEqual(expected);
  });

  it("notify with level: warning forwards warning verbatim", () => {
    const { effects } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({
        method: "notify",
        expectsResponse: false,
        payload: { message: "careful", level: "warning" },
      }),
      meta: makeMeta(),
    });
    expect(effects).toEqual([
      { type: "notify", agentId: "agent-1", message: "careful", level: "warning" },
    ]);
  });

  it("a missing text/message field does not throw (payload stays defensively read)", () => {
    expect(() =>
      reduce(initialAgentUiState, {
        type: "ui_request",
        event: makeRequest({ method: "set_editor_text", expectsResponse: false, payload: {} }),
        meta: makeMeta(),
      }),
    ).not.toThrow();
    expect(() =>
      reduce(initialAgentUiState, {
        type: "ui_request",
        event: makeRequest({ method: "notify", expectsResponse: false, payload: {} }),
        meta: makeMeta(),
      }),
    ).not.toThrow();
  });
});

// ─── remainingMs: display-only, never a control ──────────────────────────────

describe("agent-ui-state — remainingMs", () => {
  it("returns null when timeoutMs is absent", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true, timeoutMs: undefined }),
      meta: makeMeta(1000),
    });
    expect(remainingMs(state.pending["req-1"]!, 5000)).toBeNull();
  });

  it("anchors on receivedAt when present (live event)", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true, timeoutMs: 10_000, createdAt: 0 }),
      meta: makeMeta(1_000),
    });
    // now=6000, receivedAt=1000 → elapsed 5000 → remaining 5000, ignoring createdAt=0 entirely.
    expect(remainingMs(state.pending["req-1"]!, 6_000)).toBe(5_000);
  });

  it("accepts a snapshot entry's createdAt as both epoch ms and an ISO string (no receivedAt to anchor on)", () => {
    const epochState = reduce(initialAgentUiState, {
      type: "snapshot",
      pending: [makePendingRequest({ timeoutMs: 10_000, createdAt: 1_000 })],
      surfaces: [],
    }).state;
    expect(remainingMs(epochState.pending["req-1"]!, 6_000)).toBe(5_000);

    const isoState = reduce(initialAgentUiState, {
      type: "snapshot",
      pending: [
        makePendingRequest({ timeoutMs: 10_000, createdAt: new Date(1_000).toISOString() }),
      ],
      surfaces: [],
    }).state;
    expect(remainingMs(isoState.pending["req-1"]!, 6_000)).toBe(5_000);
  });

  it("clamps at 0, never negative", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true, timeoutMs: 1_000 }),
      meta: makeMeta(1_000),
    });
    expect(remainingMs(state.pending["req-1"]!, 999_999)).toBe(0);
  });

  it("never dismisses, expires, or mutates an entry: advancing now far past timeoutMs leaves the entry present and answerable", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true, timeoutMs: 1_000 }),
      meta: makeMeta(1_000),
    }).state;
    // remainingMs is a read; no reducer action exists for "timeout elapsed" — the only removal path
    // is a real ui_resolved event.
    expect(remainingMs(state.pending["req-1"]!, 999_999_999)).toBe(0);
    const after = pendingForAgent(state, "agent-1");
    expect(after).toHaveLength(1);
    expect(after[0]?.answerable).toBe(true);
    expect(state.pending["req-1"]).toBeDefined();
  });
});

// ─── Selectors ────────────────────────────────────────────────────────────────

describe("agent-ui-state — selectors", () => {
  it("pendingByAgent omits agents with zero pending dialogs", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ agentId: "agent-1", expectsResponse: true }),
      meta: makeMeta(),
    });
    const counts = pendingByAgent(state);
    expect(counts["agent-1"]).toBe(1);
    expect("agent-2" in counts).toBe(false);
  });

  it("pendingForAgent returns a stable ascending order by createdAt, requestId tie-break", () => {
    let state = initialAgentUiState;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ requestId: "req-b", createdAt: 100, expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ requestId: "req-a", createdAt: 100, expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ requestId: "req-c", createdAt: 50, expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    const order = pendingForAgent(state, "agent-1").map((e) => e.requestId);
    expect(order).toEqual(["req-c", "req-a", "req-b"]);
  });

  it("surfacesForAgent returns a stable order and only that agent's surfaces", () => {
    let state = initialAgentUiState;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-1",
        surfaceKey: "b",
        createdAt: 100,
        expectsResponse: false,
      }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-1",
        requestId: "req-2",
        surfaceKey: "a",
        createdAt: 100,
        expectsResponse: false,
      }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({
        agentId: "agent-2",
        requestId: "req-3",
        surfaceKey: "z",
        createdAt: 1,
        expectsResponse: false,
      }),
      meta: makeMeta(),
    }).state;
    const keys = surfacesForAgent(state, "agent-1").map((e) => e.surfaceKey);
    expect(keys).toEqual(["a", "b"]);
  });
});

// ─── Referential integrity ─────────────────────────────────────────────────────

describe("agent-ui-state — referential integrity", () => {
  it("every reducer call leaves its input state object untouched (deep-frozen input survives every action)", () => {
    const seed: AgentUiState = deepFreeze({
      pending: { "req-1": { ...makePendingRequest(), answerable: true } },
      surfaces: {
        [surfaceMapKey("agent-1", "status")]: { ...makeSurface(), surfaceKey: "status" },
      },
      resolved: {
        "req-resolved": {
          requestId: "req-resolved",
          agentId: "agent-1",
          method: "confirm",
          payload: {},
          createdAt: 1000,
          reason: "answered",
        },
      },
    });

    const actions: Array<Parameters<typeof reduce>[1]> = [
      {
        type: "ui_request",
        event: makeRequest({ requestId: "req-2", expectsResponse: true }),
        meta: makeMeta(),
      },
      {
        type: "ui_request",
        event: makeRequest({ surfaceKey: "status2", expectsResponse: false }),
        meta: makeMeta(),
      },
      { type: "ui_resolved", event: makeResolved({ requestId: "req-1" }) },
      { type: "snapshot", pending: [makePendingRequest()], surfaces: [makeSurface()] },
      { type: "disconnected" },
      { type: "agent_removed", agentId: "agent-1" },
      { type: "respond_sent", requestId: "req-1", response: { value: "a" } },
      { type: "respond_failed", requestId: "req-1" },
    ];

    for (const action of actions) {
      expect(() => reduce(seed, action)).not.toThrow();
    }
    expect(seed.pending["req-1"]?.answerable).toBe(true);
    expect(Object.keys(seed.surfaces)).toHaveLength(1);
  });
});

// ─── ui_resolved: retention into `resolved` ───────────────────────────────────

describe("agent-ui-state — resolved retention", () => {
  it("ui_resolved moves a known pending entry to resolved, preserving createdAt/method/agentId/payload and forwarding reason verbatim", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({
        method: "confirm",
        expectsResponse: true,
        payload: { title: "Proceed?" },
        createdAt: 4242,
      }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_resolved",
      event: makeResolved({ reason: "cancelled" }),
    }).state;

    expect(state.pending["req-1"]).toBeUndefined();
    const entry = state.resolved["req-1"];
    expect(entry).toEqual({
      requestId: "req-1",
      agentId: "agent-1",
      method: "confirm",
      payload: { title: "Proceed?" },
      createdAt: 4242,
      reason: "cancelled",
    });
  });

  it("the resolved entry carries no timeoutMs, receivedAt, answerable, or submitting", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true, timeoutMs: 5000 }),
      meta: makeMeta(1000),
    }).state;
    state = reduce(state, { type: "ui_resolved", event: makeResolved() }).state;
    const entry = state.resolved["req-1"];
    expect(entry).not.toHaveProperty("timeoutMs");
    expect(entry).not.toHaveProperty("receivedAt");
    expect(entry).not.toHaveProperty("answerable");
    expect(entry).not.toHaveProperty("submitting");
  });

  it("an unknown requestId stays a plain no-op — no synthesised resolved entry, no throw", () => {
    const { state } = reduce(initialAgentUiState, { type: "ui_resolved", event: makeResolved() });
    expect(state).toBe(initialAgentUiState);
    expect(Object.keys(state.resolved)).toHaveLength(0);
  });

  it("resolved survives snapshot and disconnected", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, { type: "ui_resolved", event: makeResolved() }).state;
    expect(state.resolved["req-1"]).toBeDefined();

    state = reduce(state, { type: "disconnected" }).state;
    expect(state.resolved["req-1"]).toBeDefined();

    state = reduce(state, { type: "snapshot", pending: [], surfaces: [] }).state;
    expect(state.resolved["req-1"]).toBeDefined();
  });

  it("agent_removed drops that agent's resolved entries, leaving other agents' untouched", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ agentId: "agent-1", requestId: "req-1", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ agentId: "agent-2", requestId: "req-2", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_resolved",
      event: makeResolved({ requestId: "req-1", agentId: "agent-1" }),
    }).state;
    state = reduce(state, {
      type: "ui_resolved",
      event: makeResolved({ requestId: "req-2", agentId: "agent-2" }),
    }).state;

    state = reduce(state, { type: "agent_removed", agentId: "agent-1" }).state;
    expect(state.resolved["req-1"]).toBeUndefined();
    expect(state.resolved["req-2"]).toBeDefined();
  });
});

// ─── respond_sent / respond_failed ─────────────────────────────────────────────

describe("agent-ui-state — respond_sent", () => {
  it("marks a known pending entry submitting: true and emits no effects", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "confirm", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    const { state: next, effects } = reduce(state, {
      type: "respond_sent",
      requestId: "req-1",
      response: { confirmed: true },
    });
    expect(next.pending["req-1"]?.submitting).toBe(true);
    expect(effects).toEqual([]);
  });

  it("an unknown requestId is a no-op", () => {
    const { state } = reduce(initialAgentUiState, {
      type: "respond_sent",
      requestId: "never-seen",
      response: {},
    });
    expect(state).toBe(initialAgentUiState);
  });
});

describe("agent-ui-state — respond_failed", () => {
  it("clears submitting on a still-pending entry, so a lost first-answer-wins race cannot leave a permanent spinner", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "confirm", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "respond_sent",
      requestId: "req-1",
      response: { confirmed: true },
    }).state;
    expect(state.pending["req-1"]?.submitting).toBe(true);

    state = reduce(state, { type: "respond_failed", requestId: "req-1" }).state;
    expect(state.pending["req-1"]?.submitting).toBeUndefined();
    expect(state.pending["req-1"]?.submittedAnswer).toBeUndefined();
    // The entry is otherwise untouched — still answerable, still present.
    expect(state.pending["req-1"]?.answerable).toBe(true);
  });

  it("is a no-op when the entry is no longer pending", () => {
    const { state } = reduce(initialAgentUiState, { type: "respond_failed", requestId: "gone" });
    expect(state).toBe(initialAgentUiState);
  });
});

// ─── select/confirm-only answer retention (storage rule, not routing) ────────

describe("agent-ui-state — answer retention is select/confirm only", () => {
  it.each(["select", "confirm"])(
    "%s: submittedAnswer is set on respond_sent and carried onto the resolved entry's answer",
    (method) => {
      let state = reduce(initialAgentUiState, {
        type: "ui_request",
        event: makeRequest({ method, expectsResponse: true }),
        meta: makeMeta(),
      }).state;
      state = reduce(state, {
        type: "respond_sent",
        requestId: "req-1",
        response: { value: "chosen-value", confirmed: true },
      }).state;
      expect(state.pending["req-1"]?.submittedAnswer).toEqual({
        value: "chosen-value",
        confirmed: true,
      });

      state = reduce(state, { type: "ui_resolved", event: makeResolved() }).state;
      expect(state.resolved["req-1"]?.answer).toEqual({ value: "chosen-value", confirmed: true });
      expect(JSON.stringify(state)).toContain("chosen-value");
    },
  );

  it.each(["input", "editor"])(
    "%s: submittedAnswer is never set, and the submitted value is unrepresentable in state",
    (method) => {
      let state = reduce(initialAgentUiState, {
        type: "ui_request",
        event: makeRequest({ method, expectsResponse: true }),
        meta: makeMeta(),
      }).state;
      state = reduce(state, {
        type: "respond_sent",
        requestId: "req-1",
        response: { value: "super-secret-token" },
      }).state;
      expect(state.pending["req-1"]).not.toHaveProperty("submittedAnswer");

      state = reduce(state, { type: "ui_resolved", event: makeResolved() }).state;
      expect(state.resolved["req-1"]).not.toHaveProperty("answer");
      // The honest form of "never appears anywhere": scan the entire serialised state, not just
      // the fields this test happened to think to check.
      expect(JSON.stringify(state)).not.toContain("super-secret-token");
    },
  );

  it("an unrecognised method also never retains an answer", () => {
    let state = reduce(initialAgentUiState, {
      type: "ui_request",
      event: makeRequest({ method: "future_dialog", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "respond_sent",
      requestId: "req-1",
      response: { value: "whatever" },
    }).state;
    expect(state.pending["req-1"]).not.toHaveProperty("submittedAnswer");
  });
});

// ─── Resolved history cap ──────────────────────────────────────────────────────

describe("agent-ui-state — RESOLVED_HISTORY_LIMIT eviction", () => {
  it("evicts the oldest resolved entry (by createdAt) once one agent exceeds the cap; other agents are untouched", () => {
    let state = initialAgentUiState;
    // One entry for agent-2 that must survive every eviction below.
    state = reduce(state, {
      type: "ui_request",
      event: makeRequest({ agentId: "agent-2", requestId: "keep-me", expectsResponse: true }),
      meta: makeMeta(),
    }).state;
    state = reduce(state, {
      type: "ui_resolved",
      event: makeResolved({ requestId: "keep-me", agentId: "agent-2" }),
    }).state;

    for (let i = 0; i < RESOLVED_HISTORY_LIMIT + 1; i++) {
      const requestId = `req-${i}`;
      state = reduce(state, {
        type: "ui_request",
        event: makeRequest({
          agentId: "agent-1",
          requestId,
          createdAt: i, // strictly increasing, so req-0 is the unambiguous oldest
          expectsResponse: true,
        }),
        meta: makeMeta(),
      }).state;
      state = reduce(state, {
        type: "ui_resolved",
        event: makeResolved({ requestId, agentId: "agent-1" }),
      }).state;
    }

    const agent1Resolved = resolvedForAgent(state, "agent-1");
    expect(agent1Resolved).toHaveLength(RESOLVED_HISTORY_LIMIT);
    expect(agent1Resolved.map((e) => e.requestId)).not.toContain("req-0");
    expect(agent1Resolved.map((e) => e.requestId)).toContain(`req-${RESOLVED_HISTORY_LIMIT}`);
    expect(state.resolved["keep-me"]).toBeDefined();
  });
});

// ─── resolvedForAgent selector ─────────────────────────────────────────────────

describe("agent-ui-state — resolvedForAgent", () => {
  it("returns a stable ascending order by createdAt, requestId tie-break, scoped to one agent", () => {
    let state = initialAgentUiState;
    for (const [requestId, createdAt, agentId] of [
      ["req-b", 100, "agent-1"],
      ["req-a", 100, "agent-1"],
      ["req-c", 50, "agent-1"],
      ["req-other", 1, "agent-2"],
    ] as const) {
      state = reduce(state, {
        type: "ui_request",
        event: makeRequest({ agentId, requestId, createdAt, expectsResponse: true }),
        meta: makeMeta(),
      }).state;
      state = reduce(state, {
        type: "ui_resolved",
        event: makeResolved({ requestId, agentId }),
      }).state;
    }
    const order = resolvedForAgent(state, "agent-1").map((e) => e.requestId);
    expect(order).toEqual(["req-c", "req-a", "req-b"]);
  });

  it("resolving a middle entry keeps its index stable in a list merged with pendingForAgent by createdAt", () => {
    let state = initialAgentUiState;
    for (const [requestId, createdAt] of [
      ["req-early", 10],
      ["req-mid", 20],
      ["req-late", 30],
    ] as const) {
      state = reduce(state, {
        type: "ui_request",
        event: makeRequest({ agentId: "agent-1", requestId, createdAt, expectsResponse: true }),
        meta: makeMeta(),
      }).state;
    }

    const before = mergePendingAndResolved(state, "agent-1");
    expect(before).toEqual(["req-early", "req-mid", "req-late"]);
    expect(before.indexOf("req-mid")).toBe(1);

    state = reduce(state, {
      type: "ui_resolved",
      event: makeResolved({ requestId: "req-mid" }),
    }).state;

    const after = mergePendingAndResolved(state, "agent-1");
    expect(after).toEqual(["req-early", "req-mid", "req-late"]);
    expect(after.indexOf("req-mid")).toBe(1);
  });
});
