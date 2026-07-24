import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { SlashCommandOperationsService } from "./slash-command-operations.js";

const NOW = "2026-07-22T12:00:00.000Z";

function makeSetup(): {
  manager: AgentManager;
  service: AgentService;
  ops: SlashCommandOperationsService;
  broadcasts: unknown[];
  saved: AgentRecord[];
} {
  const broadcasts: unknown[] = [];
  const saved: AgentRecord[] = [];
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: (r) => {
      saved.push(r);
      return Promise.resolve();
    },
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
  });
  const client = new MockAgentClient({ turnDelayMs: 0 });
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: (_, m) => broadcasts.push(m),
    now: () => NOW,
  });
  const ops = new SlashCommandOperationsService({
    manager,
    broadcast: (_, m) => broadcasts.push(m),
  });
  return { manager, service, ops, broadcasts, saved };
}

async function createAgent(service: AgentService): Promise<string> {
  const result = (await service.handleCreate(
    { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" } },
    () => [],
  )) as Record<string, unknown>;
  return (result.payload as Record<string, unknown>).agentId as string;
}

describe("unknown agent / unsupported provider", () => {
  it("agent_session_stats_request on an unknown agentId throws (→ rpc_error)", async () => {
    const { ops } = makeSetup();
    await expect(ops.handleSessionStats({ agentId: "nope" })).rejects.toThrow(/unknown agent/);
  });

  it("mock provider (no exportHtml) throws a clear unsupported error, not a silent success", async () => {
    const { service, ops } = makeSetup();
    const agentId = await createAgent(service);
    await expect(ops.handleExportHtml({ agentId })).rejects.toThrow(/does not support/);
  });
});

describe("delegation to optional AgentSession methods", () => {
  function sessionStub(overrides: Record<string, unknown> = {}) {
    return {
      provider: "mock",
      id: randomUUID(),
      capabilities: {},
      run: () => Promise.resolve(),
      startTurn: () => Promise.resolve({ turnId: "t1" }),
      subscribe: () => () => {},
      streamHistory: async function* () {},
      getRuntimeInfo: () => ({ provider: "mock" }),
      getAvailableModes: () => [],
      getCurrentMode: () => null,
      setMode: () => Promise.resolve(),
      getPendingPermissions: () => [],
      respondToPermission: () => Promise.resolve(),
      describePersistence: () => null,
      interrupt: () => Promise.resolve(),
      close: () => Promise.resolve(),
      ...overrides,
      // biome-ignore lint: test stub matches the AgentSession shape loosely
    } as unknown as import("./provider-contract.js").AgentSession;
  }

  it("agent_session_stats_request delegates to session.getSessionStats()", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        getSessionStats: () => Promise.resolve({ sessionId: "s1", totalMessages: 3 }),
      }),
    );
    const result = (await ops.handleSessionStats({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_session_stats_response",
      payload: { sessionId: "s1", totalMessages: 3 },
    });
  });

  it("agent_session_stats_request back-fills model from getRuntimeInfo() when stats omit it (sprint-042)", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        getSessionStats: () => Promise.resolve({ sessionId: "s1", totalMessages: 3 }),
        getRuntimeInfo: () => ({ provider: "mock", model: "opus" }),
      }),
    );
    const result = (await ops.handleSessionStats({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_session_stats_response",
      payload: { sessionId: "s1", totalMessages: 3, model: "opus" },
    });
  });

  it("agent_session_stats_request preserves a provider-supplied model over getRuntimeInfo() (sprint-042)", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        getSessionStats: () => Promise.resolve({ sessionId: "s1", model: "sonnet" }),
        getRuntimeInfo: () => ({ provider: "mock", model: "opus" }),
      }),
    );
    const result = (await ops.handleSessionStats({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_session_stats_response",
      payload: { sessionId: "s1", model: "sonnet" },
    });
  });

  it("agent_compact_request forwards customInstructions and broadcasts agent_update", async () => {
    const { service, ops, manager, broadcasts } = makeSetup();
    const agentId = await createAgent(service);
    let seenInstructions: string | undefined;
    manager.attachSession(
      agentId,
      sessionStub({
        compact: (instructions?: string) => {
          seenInstructions = instructions;
          return Promise.resolve({ summary: "done", tokensBefore: 500 });
        },
      }),
    );
    const result = (await ops.handleCompact(
      { agentId, customInstructions: "focus" },
      () => [],
    )) as Record<string, unknown>;
    expect(seenInstructions).toBe("focus");
    expect(result).toEqual({
      type: "agent_compact_response",
      payload: { summary: "done", tokensBefore: 500 },
    });
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId, compacted: true });
  });

  it("agent_new_session_request broadcasts idle only when not cancelled", async () => {
    const { service, ops, manager, broadcasts } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({ newSession: () => Promise.resolve({ cancelled: true }) }),
    );
    broadcasts.length = 0; // discard the agent-creation broadcast noise
    await ops.handleNewSession({ agentId }, () => []);
    expect(broadcasts).toHaveLength(0);
  });

  it("agent_switch_session_request requires sessionPath", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({ switchSession: () => Promise.resolve({ cancelled: false }) }),
    );
    await expect(ops.handleSwitchSession({ agentId }, () => [])).rejects.toThrow(
      /sessionPath is required/,
    );
  });

  it("agent_fork_request requires entryId and returns text+cancelled", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        fork: (entryId: string) => Promise.resolve({ text: `forked:${entryId}`, cancelled: false }),
      }),
    );
    const result = (await ops.handleFork({ agentId, entryId: "e1" })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_fork_response",
      payload: { text: "forked:e1", cancelled: false },
    });
  });

  it("agent_fork_messages_request returns the picker list", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        getForkMessages: () => Promise.resolve([{ entryId: "e1", text: "first" }]),
      }),
    );
    const result = (await ops.handleForkMessages({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_fork_messages_response",
      payload: { messages: [{ entryId: "e1", text: "first" }] },
    });
  });

  it("agent_clone_request broadcasts on success", async () => {
    const { service, ops, manager, broadcasts } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({ clone: () => Promise.resolve({ cancelled: false }) }),
    );
    await ops.handleClone({ agentId }, () => []);
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId });
  });

  it("agent_set_session_name_request requires name, broadcasts the new title, and persists the record", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const agentId = await createAgent(service);
    let seenName: string | undefined;
    manager.attachSession(
      agentId,
      sessionStub({
        setSessionName: (name: string) => {
          seenName = name;
          return Promise.resolve();
        },
      }),
    );
    await expect(ops.handleSetSessionName({ agentId }, () => [])).rejects.toThrow(
      /name is required/,
    );
    saved.length = 0; // drop the initial creation write
    await ops.handleSetSessionName({ agentId, name: "my-feature" }, () => []);
    expect(seenName).toBe("my-feature");
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId, title: "my-feature" });
    expect(manager.get(agentId)?.record.title).toBe("my-feature");
    expect(saved.some((r) => r.id === agentId && r.title === "my-feature")).toBe(true);
  });

  it("agent_export_html_request forwards optional outputPath", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        exportHtml: (outputPath?: string) =>
          Promise.resolve({ path: outputPath ?? "/default.html" }),
      }),
    );
    const result = (await ops.handleExportHtml({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_export_html_response",
      payload: { path: "/default.html" },
    });
  });

  it("agent_set_model_request requires provider+modelId, broadcasts, and persists the model", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({ setProviderModel: () => Promise.resolve({ id: "m1" }) }),
    );
    await expect(ops.handleSetModel({ agentId }, () => [])).rejects.toThrow(
      /provider and modelId are required/,
    );
    saved.length = 0; // drop the initial creation write
    await ops.handleSetModel({ agentId, provider: "anthropic", modelId: "m1" }, () => []);
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId, model: "m1" });
    // Persisted to the record's config so a restored session (no live `session`, e.g. right after
    // a daemon restart) still shows it — previously only the live session's runtime info carried
    // the model, which came back empty once the session was no longer attached.
    expect(manager.get(agentId)?.record.config?.model).toBe("m1");
    expect(saved.some((r) => r.id === agentId && r.config?.model === "m1")).toBe(true);
  });

  it("agent_cycle_model_request delegates, broadcasts, and persists the resulting model", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const agentId = await createAgent(service);
    let model: string | undefined;
    manager.attachSession(
      agentId,
      sessionStub({
        // Mirrors the real `pi` provider (`providers/pi/agent.ts`): `cycleModel()` updates its
        // own tracked model before returning, which `getRuntimeInfo()` then reflects.
        cycleModel: () => {
          model = "m2";
          return Promise.resolve({ model: { id: "m2" } });
        },
        getRuntimeInfo: () => ({ provider: "mock", model }),
      }),
    );
    saved.length = 0; // drop the initial creation write
    const result = (await ops.handleCycleModel({ agentId }, () => [])) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_cycle_model_response",
      payload: { model: { id: "m2" } },
    });
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId, model: "m2" });
    expect(manager.get(agentId)?.record.config?.model).toBe("m2");
    expect(saved.some((r) => r.id === agentId && r.config?.model === "m2")).toBe(true);
  });

  it("agent_last_assistant_text_request returns null when there is none", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({ getLastAssistantText: () => Promise.resolve(null) }),
    );
    const result = (await ops.handleLastAssistantText({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({ type: "agent_last_assistant_text_response", payload: { text: null } });
  });
});
