import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiStudioClient, ResolveDefaultModelResponse } from "@av-pi-studio/client";
import { useSessionStore } from "./session-store.js";
import { ensureMaterialized, resolveDefaultModel, discardIfEmpty } from "./materialize.js";

beforeEach(() => {
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

function fakeClient(
  overrides: {
    resolveDefaultModel?: () => Promise<ResolveDefaultModelResponse>;
    createAgent?: (req: unknown) => Promise<{ agentId: string }>;
  } = {},
): {
  client: PiStudioClient;
  createAgentCalls: unknown[];
  deleteCalls: string[];
} {
  const createAgentCalls: unknown[] = [];
  const deleteCalls: string[] = [];
  const createAgent =
    overrides.createAgent ??
    (() => Promise.resolve({ agentId: `agent-${createAgentCalls.length + 1}` }));
  const client = {
    providers: {
      resolveDefaultModel:
        overrides.resolveDefaultModel ??
        (() =>
          Promise.resolve({
            type: "resolve_default_model_response",
            requestId: "r1",
            provider: "pi",
            model: "claude-sonnet-5",
            modelProvider: "anthropic",
          } satisfies ResolveDefaultModelResponse)),
    },
    createAgent: (req: unknown) => {
      createAgentCalls.push(req);
      return createAgent(req);
    },
    agent: (agentId: string) => ({
      delete: () => {
        deleteCalls.push(agentId);
        return Promise.resolve({});
      },
    }),
  } as unknown as PiStudioClient;
  return { client, createAgentCalls, deleteCalls };
}

describe("resolveDefaultModel", () => {
  it("resolves the model/provider from the daemon", async () => {
    const { client } = fakeClient();
    await expect(resolveDefaultModel(client)).resolves.toEqual({
      model: "claude-sonnet-5",
      modelProvider: "anthropic",
    });
  });

  it("caches per client instance — a second call never re-issues the RPC", async () => {
    const spy = vi.fn(() =>
      Promise.resolve({
        type: "resolve_default_model_response" as const,
        requestId: "r1",
        provider: "pi",
        model: "claude-sonnet-5",
        modelProvider: "anthropic",
      }),
    );
    const { client } = fakeClient({ resolveDefaultModel: spy });

    await resolveDefaultModel(client);
    await resolveDefaultModel(client);
    await resolveDefaultModel(client);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("two different client instances (e.g. across a reconnect) get independent caches", async () => {
    const spyA = vi.fn(() =>
      Promise.resolve({
        type: "resolve_default_model_response" as const,
        requestId: "r1",
        provider: "pi",
        model: "model-a",
      }),
    );
    const spyB = vi.fn(() =>
      Promise.resolve({
        type: "resolve_default_model_response" as const,
        requestId: "r2",
        provider: "pi",
        model: "model-b",
      }),
    );
    const { client: clientA } = fakeClient({ resolveDefaultModel: spyA });
    const { client: clientB } = fakeClient({ resolveDefaultModel: spyB });

    await expect(resolveDefaultModel(clientA)).resolves.toEqual({
      model: "model-a",
      modelProvider: undefined,
    });
    await expect(resolveDefaultModel(clientB)).resolves.toEqual({
      model: "model-b",
      modelProvider: undefined,
    });
    expect(spyA).toHaveBeenCalledTimes(1);
    expect(spyB).toHaveBeenCalledTimes(1);
  });

  it("a rejected lookup resolves to an empty result instead of throwing", async () => {
    const { client } = fakeClient({ resolveDefaultModel: () => Promise.reject(new Error("boom")) });
    await expect(resolveDefaultModel(client)).resolves.toEqual({});
  });
});

describe("ensureMaterialized", () => {
  it("returns the already-bound agentId immediately, without calling createAgent", async () => {
    useSessionStore.getState().hydrate({
      id: "s1",
      agentId: "agent-existing",
      title: "chat",
      status: "idle",
      cwd: "/work",
      timeline: { rows: [] } as never,
      userMessageCount: 0,
    });
    const { client, createAgentCalls } = fakeClient();

    await expect(ensureMaterialized(client, "s1")).resolves.toBe("agent-existing");
    expect(createAgentCalls).toHaveLength(0);
  });

  it("rejects for an unknown sessionId", async () => {
    const { client } = fakeClient();
    await expect(ensureMaterialized(client, "no-such-session")).rejects.toThrow(/unknown session/);
  });

  it("materializes an unbound draft: createAgent with no initialPrompt, carrying the entry's model, then binds agentId", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    useSessionStore.getState().setModel(sessionId, "claude-sonnet-5", "anthropic");
    const { client, createAgentCalls } = fakeClient({
      createAgent: () => Promise.resolve({ agentId: "agent-new" }),
    });

    const agentId = await ensureMaterialized(client, sessionId);

    expect(agentId).toBe("agent-new");
    expect(useSessionStore.getState().sessions[sessionId]?.agentId).toBe("agent-new");
    expect(createAgentCalls).toEqual([
      {
        config: {
          provider: "pi",
          cwd: "/work",
          model: "claude-sonnet-5",
          modelProvider: "anthropic",
        },
        labels: {},
      },
    ]);
  });

  it("seeds the default model into the store and into the createAgent config when the entry has none", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { client, createAgentCalls } = fakeClient();

    await ensureMaterialized(client, sessionId);

    expect(createAgentCalls).toEqual([
      {
        config: {
          provider: "pi",
          cwd: "/work",
          model: "claude-sonnet-5",
          modelProvider: "anthropic",
        },
        labels: {},
      },
    ]);
    expect(useSessionStore.getState().sessions[sessionId]?.model).toBe("claude-sonnet-5");
  });
  it("seeds the resolved default thinking level for DISPLAY only — never into the createAgent config (sprint-070)", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { client, createAgentCalls } = fakeClient({
      resolveDefaultModel: () =>
        Promise.resolve({
          type: "resolve_default_model_response",
          requestId: "r1",
          provider: "pi",
          model: "claude-sonnet-5",
          modelProvider: "anthropic",
          thinkingLevel: "medium",
        } satisfies ResolveDefaultModelResponse),
    });

    await ensureMaterialized(client, sessionId);

    // The composer's selector shows the real default…
    expect(useSessionStore.getState().sessions[sessionId]?.thinkingLevel).toBe("medium");
    // …but the record stays unpinned: `spawnOrResumeSession` skips the thinking replay when
    // `config.thinkingOptionId` is undefined, keeping Pi's own default authoritative.
    expect(createAgentCalls).toEqual([
      {
        config: {
          provider: "pi",
          cwd: "/work",
          model: "claude-sonnet-5",
          modelProvider: "anthropic",
        },
        labels: {},
      },
    ]);
  });

  it("an explicit thinking pick before materialize is kept and not overwritten by the resolved default", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    useSessionStore.getState().setThinkingLevel(sessionId, "high");
    const { client } = fakeClient({
      resolveDefaultModel: () =>
        Promise.resolve({
          type: "resolve_default_model_response",
          requestId: "r1",
          provider: "pi",
          model: "claude-sonnet-5",
          modelProvider: "anthropic",
          thinkingLevel: "medium",
        } satisfies ResolveDefaultModelResponse),
    });

    await ensureMaterialized(client, sessionId);

    expect(useSessionStore.getState().sessions[sessionId]?.thinkingLevel).toBe("high");
  });

  it("an explicit pick landing during the default-model lookup wins over the resolved default", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { promise: lookupPromise, resolve: resolveLookup } = Promise.withResolvers<{
      type: "resolve_default_model_response";
      requestId: string;
      provider: string;
      model?: string;
      modelProvider?: string;
    }>();
    const { client, createAgentCalls } = fakeClient({
      resolveDefaultModel: () => lookupPromise,
    });

    const materialized = ensureMaterialized(client, sessionId);
    useSessionStore.getState().setModel(sessionId, "gpt-5", "openai");
    resolveLookup({
      type: "resolve_default_model_response",
      requestId: "r1",
      provider: "pi",
      model: "claude-sonnet-5",
      modelProvider: "anthropic",
    });
    await materialized;

    expect(createAgentCalls).toEqual([
      {
        config: { provider: "pi", cwd: "/work", model: "gpt-5", modelProvider: "openai" },
        labels: {},
      },
    ]);
  });

  it("materializes with no model when the default lookup itself resolves to nothing (cached empty result)", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { client, createAgentCalls } = fakeClient({
      resolveDefaultModel: () => Promise.reject(new Error("boom")),
    });

    await ensureMaterialized(client, sessionId);

    expect(createAgentCalls).toEqual([{ config: { provider: "pi", cwd: "/work" }, labels: {} }]);
  });

  it("concurrent callers share one in-flight materialize instead of double-creating", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { promise: createPromise, resolve: resolveCreate } = Promise.withResolvers<{
      agentId: string;
    }>();
    const { client, createAgentCalls } = fakeClient({
      createAgent: () => createPromise,
    });

    const first = ensureMaterialized(client, sessionId);
    const second = ensureMaterialized(client, sessionId);
    resolveCreate({ agentId: "agent-shared" });

    await expect(first).resolves.toBe("agent-shared");
    await expect(second).resolves.toBe("agent-shared");
    expect(createAgentCalls).toHaveLength(1);
  });

  it("a later call after materialization settles returns the bound agentId without re-creating", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { client, createAgentCalls } = fakeClient({
      createAgent: () => Promise.resolve({ agentId: "agent-once" }),
    });

    await ensureMaterialized(client, sessionId);
    await ensureMaterialized(client, sessionId);

    expect(createAgentCalls).toHaveLength(1);
  });
});
describe("discardIfEmpty", () => {
  it("hard-deletes and removes a never-used, already-bound session", async () => {
    useSessionStore.getState().hydrate({
      id: "s1",
      agentId: "agent-1",
      title: "New chat",
      status: "idle",
      cwd: "/work",
      timeline: { rows: [] } as never,
      userMessageCount: 0,
    });
    const { client, deleteCalls } = fakeClient();

    await expect(discardIfEmpty(client, "s1")).resolves.toBe(true);

    expect(deleteCalls).toEqual(["agent-1"]);
    expect(useSessionStore.getState().sessions["s1"]).toBeUndefined();
    expect(useSessionStore.getState().order).not.toContain("s1");
  });

  it("keeps a session with any timeline row, even if bound", async () => {
    useSessionStore.getState().hydrate({
      id: "s1",
      agentId: "agent-1",
      title: "chat",
      status: "idle",
      cwd: "/work",
      timeline: { rows: [{}] } as never,
      userMessageCount: 0,
    });
    const { client, deleteCalls } = fakeClient();

    await expect(discardIfEmpty(client, "s1")).resolves.toBe(false);

    expect(deleteCalls).toHaveLength(0);
    expect(useSessionStore.getState().sessions["s1"]).toBeDefined();
  });

  it("removes an offline (never-materialized) draft locally, with no RPC", async () => {
    useSessionStore.getState().hydrate({
      id: "s1",
      agentId: null,
      title: "New chat",
      status: "idle",
      cwd: "/work",
      timeline: { rows: [] } as never,
      userMessageCount: 0,
    });
    const { client, deleteCalls } = fakeClient();

    await expect(discardIfEmpty(client, "s1")).resolves.toBe(true);

    expect(deleteCalls).toHaveLength(0);
    expect(useSessionStore.getState().sessions["s1"]).toBeUndefined();
  });

  it("awaits an in-flight materialize and deletes the agent it just created, leaking nothing", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { promise: createPromise, resolve: resolveCreate } = Promise.withResolvers<{
      agentId: string;
    }>();
    const { client, deleteCalls } = fakeClient({
      createAgent: () => createPromise,
    });

    void ensureMaterialized(client, sessionId);
    const discarded = discardIfEmpty(client, sessionId);
    resolveCreate({ agentId: "agent-eager" });

    await expect(discarded).resolves.toBe(true);
    expect(deleteCalls).toEqual(["agent-eager"]);
    expect(useSessionStore.getState().sessions[sessionId]).toBeUndefined();
  });
});
