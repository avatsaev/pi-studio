import { describe, expect, it, vi } from "vitest";

import { MockAgentClient, MockAgentSession } from "../providers/mock/mock-provider.js";
import type { AgentSession, ProviderUiRequest, ProviderUiResponse } from "../provider-contract.js";
import { AgentUiService } from "./agent-ui-service.js";

/** Every broadcast the service sends is `{ type: "session", message: {...} }` — unwrap for
 *  assertions on the inner `agent_ui_request`/`agent_ui_resolved` message. */
function messagesOf(calls: unknown[][]): Record<string, unknown>[] {
  return calls.map((c) => (c[1] as { message: Record<string, unknown> }).message);
}

async function mockSession(): Promise<MockAgentSession> {
  const client = new MockAgentClient();
  return (await client.createSession({ provider: "mock", cwd: "/tmp" })) as MockAgentSession;
}

/** A minimal fake with fine-grained control over `onUiRequest`/`respondToUi`, for edge cases
 *  `MockAgentSession` cannot express (missing member, throwing member). Convention matches
 *  `archive.test.ts`'s `fakeSession()` / `session-ops.test.ts` (`as unknown as AgentSession`). */
function fakeSession(overrides: {
  onUiRequest?: boolean;
  respondToUi?: ((providerRequestId: string, response: ProviderUiResponse) => void) | false;
}): { session: AgentSession; fire: (req: ProviderUiRequest) => void; calls: unknown[][] } {
  let cb: ((req: ProviderUiRequest) => void) | undefined;
  const calls: unknown[][] = [];
  const respondToUi =
    overrides.respondToUi === false
      ? undefined
      : (overrides.respondToUi ??
        ((providerRequestId: string, response: ProviderUiResponse) => {
          calls.push([providerRequestId, response]);
        }));
  const session = {
    ...(overrides.onUiRequest === false
      ? {}
      : {
          onUiRequest(callback: (req: ProviderUiRequest) => void) {
            cb = callback;
            return () => {
              cb = undefined;
            };
          },
        }),
    ...(respondToUi ? { respondToUi } : {}),
  } as unknown as AgentSession;
  return { session, fire: (req) => cb?.(req), calls };
}

function makeService(overrides?: {
  logger?: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
}): { service: AgentUiService; broadcast: ReturnType<typeof vi.fn> } {
  const broadcast = vi.fn();
  const service = new AgentUiService({
    broadcast,
    getActiveSessions: () => [],
    logger: overrides?.logger as never,
    setTimer: overrides?.setTimer,
    clearTimer: overrides?.clearTimer,
  });
  return { service, broadcast };
}

describe("AgentUiService", () => {
  it("a dialog request becomes exactly one pending entry and one broadcast whose requestId is not the provider's id", async () => {
    const { service, broadcast } = makeService();
    const session = await mockSession();
    service.attach("a1", session);

    const req = session.emitUiRequest({ method: "confirm", payload: { message: "Proceed?" } });

    expect(broadcast).toHaveBeenCalledTimes(1);
    const [msg] = messagesOf(broadcast.mock.calls);
    expect(msg!.type).toBe("agent_ui_request");
    expect(msg!.requestId).not.toBe(req.requestId);
    expect(typeof msg!.requestId).toBe("string");

    const pending = service.listPending("a1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.requestId).toBe(msg!.requestId);
    expect(pending[0]!.payload).toEqual({ message: "Proceed?" });
  });

  it("two sessions emitting the same provider-scoped id yield two independent, independently-answerable entries", async () => {
    const { service, broadcast } = makeService();
    const session1 = await mockSession();
    const session2 = await mockSession();
    service.attach("a1", session1);
    service.attach("a2", session2);

    session1.emitUiRequest({ requestId: "dup-id", method: "confirm" });
    session2.emitUiRequest({ requestId: "dup-id", method: "confirm" });

    const wireIds = messagesOf(broadcast.mock.calls).map((m) => m.requestId as string);
    expect(new Set(wireIds).size).toBe(2);

    expect(service.respond(wireIds[0]!, { confirmed: true })).toEqual({ ok: true });
    expect(session1.uiResponses).toEqual([
      { providerRequestId: "dup-id", response: { confirmed: true } },
    ]);
    expect(session2.uiResponses).toEqual([]);

    expect(service.respond(wireIds[1]!, { confirmed: false })).toEqual({ ok: true });
    expect(session2.uiResponses).toEqual([
      { providerRequestId: "dup-id", response: { confirmed: false } },
    ]);
  });

  it("a fire-and-forget request is broadcast but never pending; answering it returns not_found", async () => {
    const { service, broadcast } = makeService();
    const session = await mockSession();
    service.attach("a1", session);

    session.emitUiRequest({ method: "notify", expectsResponse: false });

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(service.listPending("a1")).toEqual([]);
    const [msg] = messagesOf(broadcast.mock.calls);
    expect(service.respond(msg!.requestId as string, {})).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("respond forwards the answer verbatim to the owning session's respondToUi with the provider id, and broadcasts reason:answered", async () => {
    const { service, broadcast } = makeService();
    const session = await mockSession();
    service.attach("a1", session);
    const req = session.emitUiRequest({ requestId: "p1", method: "select" });
    const [msg] = messagesOf(broadcast.mock.calls);

    const result = service.respond(msg!.requestId as string, { value: "Allow" });

    expect(result).toEqual({ ok: true });
    expect(session.uiResponses).toEqual([
      { providerRequestId: req.requestId, response: { value: "Allow" } },
    ]);
    const resolved = messagesOf(broadcast.mock.calls).at(-1);
    expect(resolved).toMatchObject({
      type: "agent_ui_resolved",
      agentId: "a1",
      reason: "answered",
    });
  });

  it("two concurrent answers: first ok:true, second not_found, provider spy received exactly one response", async () => {
    const { service, broadcast } = makeService();
    const session = await mockSession();
    service.attach("a1", session);
    session.emitUiRequest({ method: "confirm" });
    const [msg] = messagesOf(broadcast.mock.calls);
    const wireId = msg!.requestId as string;

    expect(service.respond(wireId, { confirmed: true })).toEqual({ ok: true });
    expect(service.respond(wireId, { confirmed: false })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(session.uiResponses).toHaveLength(1);
  });

  it("a session lacking respondToUi yields ok:false, error:unsupported", () => {
    const { service, broadcast } = makeService();
    const { session, fire } = fakeSession({ onUiRequest: true, respondToUi: false });
    service.attach("a1", session);
    fire({ requestId: "p1", method: "confirm", expectsResponse: true, payload: {} });

    const [msg] = messagesOf(broadcast.mock.calls);
    expect(service.respond(msg!.requestId as string, { confirmed: true })).toEqual({
      ok: false,
      error: "unsupported",
    });
  });

  it("a respondToUi that throws still returns ok:true and still broadcasts agent_ui_resolved (try/finally)", () => {
    const { service, broadcast } = makeService();
    const { session, fire } = fakeSession({
      onUiRequest: true,
      respondToUi: () => {
        throw new Error("dead stdin");
      },
    });
    service.attach("a1", session);
    fire({ requestId: "p1", method: "confirm", expectsResponse: true, payload: {} });
    const [msg] = messagesOf(broadcast.mock.calls);

    const result = service.respond(msg!.requestId as string, { confirmed: true });

    expect(result).toEqual({ ok: true });
    const resolved = messagesOf(broadcast.mock.calls).at(-1);
    expect(resolved).toMatchObject({ type: "agent_ui_resolved", reason: "answered" });
  });

  it("a surface request retains under its surfaceKey, last-value-wins; listSurfaces returns one entry with the newest payload", async () => {
    const { service } = makeService();
    const session = await mockSession();
    service.attach("a1", session);

    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:my-ext",
      payload: { statusText: "first" },
    });
    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:my-ext",
      payload: { statusText: "second" },
    });

    const surfaces = service.listSurfaces("a1");
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.payload).toEqual({ statusText: "second" });
    expect(typeof surfaces[0]!.updatedAt).toBe("number");
  });

  it("removed:true deletes the surface, still broadcasts, and the key is absent from listSurfaces", async () => {
    const { service, broadcast } = makeService();
    const session = await mockSession();
    service.attach("a1", session);

    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:my-ext",
      payload: { statusText: "running" },
    });
    expect(service.listSurfaces("a1")).toHaveLength(1);

    const callsBefore = broadcast.mock.calls.length;
    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:my-ext",
      removed: true,
      payload: {},
    });

    expect(service.listSurfaces("a1")).toEqual([]);
    expect(broadcast.mock.calls.length).toBe(callsBefore + 1);
    const [msg] = messagesOf(broadcast.mock.calls.slice(-1));
    expect(msg!.removed).toBe(true);
  });

  it("status:x and widget:x coexist as two surfaces (task-002 namespacing, verified end to end)", async () => {
    const { service } = makeService();
    const session = await mockSession();
    service.attach("a1", session);

    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:my-ext",
      payload: { statusText: "running" },
    });
    session.emitUiRequest({
      method: "setWidget",
      expectsResponse: false,
      surfaceKey: "widget:my-ext",
      payload: { widgetLines: ["a"] },
    });

    const keys = service.listSurfaces("a1").map((s) => s.surfaceKey);
    expect(new Set(keys)).toEqual(new Set(["status:my-ext", "widget:my-ext"]));
  });

  it("timeoutMs expiry drops the entry and broadcasts reason:timeout while the provider spy records zero responses", async () => {
    vi.useFakeTimers();
    try {
      const { service, broadcast } = makeService();
      const session = await mockSession();
      service.attach("a1", session);

      session.emitUiRequest({ method: "confirm", timeoutMs: 5000 });
      expect(service.listPending("a1")).toHaveLength(1);

      vi.advanceTimersByTime(5000);

      expect(service.listPending("a1")).toEqual([]);
      const resolved = messagesOf(broadcast.mock.calls).at(-1);
      expect(resolved).toMatchObject({ type: "agent_ui_resolved", reason: "timeout" });
      expect(session.uiResponses).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an untimed dialog is still pending after a long simulated idle — no daemon-side TTL", async () => {
    vi.useFakeTimers();
    try {
      const { service } = makeService();
      const session = await mockSession();
      service.attach("a1", session);

      session.emitUiRequest({ method: "input" });
      vi.advanceTimersByTime(1000 * 60 * 60 * 24);

      expect(service.listPending("a1")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweep cancels toward the entry's captured session, broadcasts the reason, unsubscribes, and empties pending/surfaces/channels", async () => {
    const { service, broadcast } = makeService();
    const session = await mockSession();
    service.attach("a1", session);
    session.emitUiRequest({ method: "confirm" });
    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:x",
      payload: {},
    });

    service.sweep("a1", "aborted");

    expect(service.listPending("a1")).toEqual([]);
    expect(service.listSurfaces("a1")).toEqual([]);
    expect(session.uiResponses).toEqual([
      { providerRequestId: expect.any(String), response: { cancelled: true } },
    ]);
    const resolved = messagesOf(broadcast.mock.calls).find(
      (m) => m.type === "agent_ui_resolved" && m.reason === "aborted",
    );
    expect(resolved).toBeDefined();

    // The channel was unsubscribed — a post-sweep emission from the same (now-detached) session
    // must not re-create a surface.
    const callsBefore = broadcast.mock.calls.length;
    session.emitUiRequest({
      method: "setStatus",
      expectsResponse: false,
      surfaceKey: "status:x",
      payload: { statusText: "zombie" },
    });
    expect(broadcast.mock.calls.length).toBe(callsBefore);
    expect(service.listSurfaces("a1")).toEqual([]);
  });

  it("attach on an agent with pending entries sweeps them as aborted before subscribing the new session", async () => {
    const { service, broadcast } = makeService();
    const session1 = await mockSession();
    service.attach("a1", session1);
    session1.emitUiRequest({ method: "confirm" });
    expect(service.listPending("a1")).toHaveLength(1);

    const session2 = await mockSession();
    service.attach("a1", session2);

    expect(session1.uiResponses).toEqual([
      { providerRequestId: expect.any(String), response: { cancelled: true } },
    ]);
    expect(service.listPending("a1")).toEqual([]);
    const resolved = messagesOf(broadcast.mock.calls).find(
      (m) => m.type === "agent_ui_resolved" && m.reason === "aborted",
    );
    expect(resolved).toBeDefined();

    // The new session is live: it can produce traffic.
    session2.emitUiRequest({ method: "notify", expectsResponse: false });
    const last = messagesOf(broadcast.mock.calls).at(-1);
    expect(last).toMatchObject({ type: "agent_ui_request", method: "notify" });
  });

  it("a session without onUiRequest attaches silently: no subscription, no error, no traffic", () => {
    const { service, broadcast } = makeService();
    const { session } = fakeSession({ onUiRequest: false });

    expect(() => service.attach("a1", session)).not.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
    expect(service.listPending("a1")).toEqual([]);
    expect(service.listSurfaces("a1")).toEqual([]);
  });

  it("never logs payload or response values", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const { service } = makeService({ logger: { info, warn } });
    const session = await mockSession();
    service.attach("a1", session);

    const SECRET = "sk-super-secret-token";
    // Unknown-method path (the one place `info` fires): payload carries a secret.
    session.emitUiRequest({ method: "someFutureThing", payload: { value: SECRET } });
    const pending = service.listPending("a1");
    service.respond(pending[0]!.requestId, { value: SECRET });

    // respondToUi-throw path (the one place `warn` fires): the thrown error message is a generic
    // transport failure, deliberately UNRELATED to the response value — this proves the service's
    // own log line never embeds `response` itself, independent of whatever text a provider's
    // exception happens to carry (which this service does not control).
    const { session: throwingSession, fire } = fakeSession({
      onUiRequest: true,
      respondToUi: () => {
        throw new Error("write EPIPE");
      },
    });
    service.attach("a2", throwingSession);
    fire({ requestId: "p1", method: "confirm", expectsResponse: true, payload: {} });
    const pending2 = service.listPending("a2");
    service.respond(pending2[0]!.requestId, { value: SECRET });

    const allLogArgs = [...info.mock.calls, ...warn.mock.calls].map((call) => call[0] as object);
    expect(allLogArgs.length).toBeGreaterThan(0);
    for (const arg of allLogArgs) {
      expect(arg).not.toHaveProperty("payload");
      expect(arg).not.toHaveProperty("response");
      expect(JSON.stringify(arg)).not.toContain(SECRET);
    }
  });
});
