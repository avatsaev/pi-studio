import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiStudioClient, ResolveDefaultModelResponse } from "@av-pi-studio/client";
import { useSessionStore } from "./session-store.js";
import { ensureMaterialized, resolveDefaultModel } from "./materialize.js";

beforeEach(() => {
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

function fakeClient(overrides: {
  resolveDefaultModel?: () => Promise<ResolveDefaultModelResponse>;
  createAgent?: (req: unknown) => Promise<{ agentId: string }>;
} = {}): { client: PiStudioClient; createAgentCalls: unknown[] } {
  const createAgentCalls: unknown[] = [];
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
  } as unknown as PiStudioClient;
  return { client, createAgentCalls };
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
        config: { provider: "pi", cwd: "/work", model: "claude-sonnet-5", modelProvider: "anthropic" },
        labels: {},
      },
    ]);
  });

  it("materializes without a model when none is set on the entry (untouched draft, no preselect yet)", async () => {
    useSessionStore.getState().createSession("/work");
    const sessionId = useSessionStore.getState().order[0]!;
    const { client, createAgentCalls } = fakeClient();

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
