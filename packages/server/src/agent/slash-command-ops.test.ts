import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { AgentClient, AgentSession } from "./provider-contract.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline, seedTimeline } from "./agent-service.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { SlashCommandOperationsService } from "./slash-command-operations.js";
import type { TimelineRow } from "./timeline-store.js";

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
    resolveClient: () => client,
    broadcast: (_, m) => broadcasts.push(m),
  });
  return { manager, service, ops, broadcasts, saved };
}

/** Eagerly spawns a live mock session — `handleCreate` no longer spawns a provider process when
 * `initialPrompt` is omitted (deferred draft creation), so this passes one explicitly. Every
 * delegation test below needs a live `session` to exercise, whether from this spawn or a later
 * `manager.attachSession(agentId, sessionStub(...))` override. */
async function createAgent(service: AgentService): Promise<string> {
  const result = (await service.handleCreate(
    { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" }, initialPrompt: "hi" },
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

describe("delegation to optional AgentSession methods", () => {
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
    const result = (await ops.handleFork({ agentId, entryId: "e1" }, () => [])) as Record<
      string,
      unknown
    >;
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

  it("agent_fork_request, agent_fork_messages_request, and agent_clone_request all lazily resume a restart-recovered agent instead of throwing 'has no live session' (real bug: every agent survives a daemon restart with session === null until something re-spawns it, and the fork picker was the first RPC the fork flow made — nobody could even open the fork UI on a recovered conversation)", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    // Simulate exactly what boot recovery leaves behind: a record with a persisted handle but no
    // attached provider session (`session-ops.test.ts`'s `managed.session = null` pattern).
    manager.get(agentId)!.session = null;
    expect(manager.get(agentId)?.session).toBeNull();

    const messagesResult = (await ops.handleForkMessages({ agentId })) as Record<string, unknown>;
    expect(messagesResult).toEqual({
      type: "agent_fork_messages_response",
      payload: { messages: [{ entryId: "mock-entry-0", text: "mock first prompt" }] },
    });
    // The lazy resume attaches a real session going forward, just like a real send would.
    expect(manager.get(agentId)?.session).not.toBeNull();

    manager.get(agentId)!.session = null;
    const forkResult = (await ops.handleFork({ agentId, entryId: "e1" }, () => [])) as Record<
      string,
      unknown
    >;
    expect(forkResult).toEqual({
      type: "agent_fork_response",
      payload: { text: "mock forked text for e1", cancelled: false },
    });
    expect(manager.get(agentId)?.session).not.toBeNull();

    manager.get(agentId)!.session = null;
    const cloneResult = (await ops.handleClone({ agentId }, () => [])) as Record<string, unknown>;
    expect(cloneResult).toEqual({ type: "agent_clone_response", payload: { cancelled: false } });
    expect(manager.get(agentId)?.session).not.toBeNull();
  });

  /**
   * `/new`, `/resume`, `/fork` and `/clone` move the provider onto a different native session
   * file. The record's `persistence` handle is what a restarted daemon rehydrates the timeline
   * from and resumes into (`timeline-rpc.ts`, `spawnOrResumeSession`), so it has to follow — a
   * stale handle silently restores and continues the pre-operation conversation.
   */
  function reboundStub(op: string, body: Record<string, unknown>): AgentSession {
    let handle = { provider: "mock", sessionId: "s0", nativeHandle: "/sessions/before.jsonl" };
    return sessionStub({
      describePersistence: () => handle,
      [op]: () => {
        handle = { provider: "mock", sessionId: "s1", nativeHandle: "/sessions/after.jsonl" };
        return Promise.resolve(body);
      },
    });
  }

  it.each([
    [
      "newSession",
      {},
      (ops: SlashCommandOperationsService, agentId: string) =>
        ops.handleNewSession({ agentId }, () => []),
    ],
    [
      "switchSession",
      {},
      (ops: SlashCommandOperationsService, agentId: string) =>
        ops.handleSwitchSession({ agentId, sessionPath: "/sessions/after.jsonl" }, () => []),
    ],
    [
      "fork",
      { text: "" },
      (ops: SlashCommandOperationsService, agentId: string) =>
        ops.handleFork({ agentId, entryId: "e1" }, () => []),
    ],
    [
      "clone",
      {},
      (ops: SlashCommandOperationsService, agentId: string) =>
        ops.handleClone({ agentId }, () => []),
    ],
  ] as const)("%s persists the rebound session handle onto the record", async (op, extra, call) => {
    const { service, ops, manager, saved } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(agentId, reboundStub(op, { cancelled: false, ...extra }));
    saved.length = 0;
    await call(ops, agentId);
    expect(manager.get(agentId)?.record.persistence?.nativeHandle).toBe("/sessions/after.jsonl");
    expect(saved.at(-1)?.persistence?.nativeHandle).toBe("/sessions/after.jsonl");
  });

  it("leaves the record's handle alone when a rebinding op is cancelled", async () => {
    const { service, ops, manager, saved } = makeSetup();
    const agentId = await createAgent(service);
    // `handleCreate` already persisted the spawned mock session's handle; a cancelled `/new` must
    // neither overwrite it with the stub's nor re-save the record at all.
    const before = manager.get(agentId)?.record.persistence;
    expect(before?.nativeHandle).toMatch(/^mock:/);
    manager.attachSession(
      agentId,
      sessionStub({
        describePersistence: () => ({ provider: "mock", nativeHandle: "/sessions/after.jsonl" }),
        newSession: () => Promise.resolve({ cancelled: true }),
      }),
    );
    saved.length = 0;
    await ops.handleNewSession({ agentId }, () => []);
    expect(manager.get(agentId)?.record.persistence).toEqual(before);
    expect(saved).toHaveLength(0);
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

  it("agent_set_model_request requires provider+modelId, broadcasts, and persists the model+provider", async () => {
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
    expect(broadcasts).toContainEqual({
      type: "agent_update",
      agentId,
      model: "m1",
      modelProvider: "anthropic",
    });
    // Persisted to the record's config so a restored session (no live `session`, e.g. right after
    // a daemon restart) still shows it — previously only the live session's runtime info carried
    // the model, which came back empty once the session was no longer attached. `modelProvider`
    // must travel alongside `model` — dropping it left a restored session's next pick from
    // silently no-op'ing (`handleSelectModel`'s `if (!modelProvider) return`).
    expect(manager.get(agentId)?.record.config?.model).toBe("m1");
    expect(manager.get(agentId)?.record.config?.modelProvider).toBe("anthropic");
    expect(saved.some((r) => r.id === agentId && r.config?.model === "m1")).toBe(true);
  });

  it("agent_set_model_request on a still-unspawned deferred draft persists directly instead of throwing (real bug: picking a model before the first send silently never saved, reverting to the default on the next reconnect)", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    // Deferred-draft creation: no `initialPrompt` means `handleCreate` persists the record but
    // never spawns a provider process (`agent-service.ts` `handleCreate`'s deferred branch) —
    // `managed.session` stays `null` exactly like a real "New chat" tab before anything is sent.
    const created = (await service.handleCreate(
      { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" } },
      () => [],
    )) as Record<string, unknown>;
    const agentId = (created.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.session).toBeNull();
    saved.length = 0; // drop the initial creation write

    const result = (await ops.handleSetModel(
      { agentId, provider: "anthropic", modelId: "m1" },
      () => [],
    )) as Record<string, unknown>;

    expect(result).toEqual({
      type: "agent_set_model_response",
      payload: { id: "m1", provider: "anthropic" },
    });
    expect(broadcasts).toContainEqual({
      type: "agent_update",
      agentId,
      model: "m1",
      modelProvider: "anthropic",
    });
    expect(manager.get(agentId)?.record.config?.model).toBe("m1");
    expect(manager.get(agentId)?.record.config?.modelProvider).toBe("anthropic");
    expect(saved.some((r) => r.id === agentId && r.config?.model === "m1")).toBe(true);
    // No live session to spawn or attach — the pick is pure config-persistence, replayed only
    // once `spawnOrResumeSession` first spawns the process on the eventual first send.
    expect(manager.get(agentId)?.session).toBeNull();
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
  it("agent_set_model_request on a live session writes back the clamped effective thinking level and broadcasts it (sprint-070)", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        // Mirrors the real `pi` provider after task-001: `setProviderModel` re-reads
        // `get_state`, and the post-switch level (clamped to `off` by the non-reasoning
        // model) is what `getRuntimeInfo()` reports.
        setProviderModel: () => Promise.resolve({ id: "m1" }),
        getRuntimeInfo: () => ({ provider: "mock", model: "m1", thinkingLevel: "off" }),
      }),
    );
    saved.length = 0;

    await ops.handleSetModel({ agentId, provider: "anthropic", modelId: "m1" }, () => []);

    expect(manager.get(agentId)?.record.config?.thinkingOptionId).toBe("off");
    expect(saved.some((r) => r.id === agentId && r.config?.thinkingOptionId === "off")).toBe(true);
    expect(broadcasts).toContainEqual({
      type: "agent_update",
      agentId,
      model: "m1",
      modelProvider: "anthropic",
      thinkingLevel: "off",
    });
  });

  it("agent_cycle_model_request writes back the effective thinking level alongside the model (sprint-070)", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({
        cycleModel: () => Promise.resolve({ model: { id: "m2" }, thinkingLevel: "low" }),
        getRuntimeInfo: () => ({ provider: "mock", model: "m2", thinkingLevel: "low" }),
      }),
    );
    saved.length = 0;

    await ops.handleCycleModel({ agentId }, () => []);

    expect(manager.get(agentId)?.record.config?.thinkingOptionId).toBe("low");
    expect(broadcasts).toContainEqual({
      type: "agent_update",
      agentId,
      model: "m2",
      thinkingLevel: "low",
    });
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

  it("agent_list_commands_request delegates to session.listCommands() (sprint-040)", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    const commands = [
      { id: "review", name: "review", description: "Run a review", source: "extension" as const },
      { id: "fix-tests", name: "fix-tests", source: "prompt" as const, scope: "project" as const },
    ];
    manager.attachSession(agentId, sessionStub({ listCommands: () => Promise.resolve(commands) }));
    const result = (await ops.handleListCommands({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({ type: "agent_list_commands_response", payload: { commands } });
  });

  it("agent_list_commands_request throws a clear unsupported error when listCommands is absent (sprint-040)", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(agentId, sessionStub());
    await expect(ops.handleListCommands({ agentId })).rejects.toThrow(/does not support/);
  });
  it("agent_set_thinking_request on a live session applies, then answers/persists/broadcasts the CLAMPED effective level (sprint-070)", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const agentId = await createAgent(service);
    const applied: string[] = [];
    manager.attachSession(
      agentId,
      sessionStub({
        // Mirrors the real `pi` provider: applies, then `getRuntimeInfo()` reports the
        // clamped value re-read from Pi, not the requested one.
        setThinkingOption: (id: string) => {
          applied.push(id);
          return Promise.resolve();
        },
        getRuntimeInfo: () => ({ provider: "mock", thinkingLevel: "off" }),
      }),
    );
    saved.length = 0; // drop the initial creation write

    const result = (await ops.handleSetThinking({ agentId, level: "high" }, () => [])) as Record<
      string,
      unknown
    >;

    expect(applied).toEqual(["high"]);
    expect(result).toEqual({
      type: "agent_set_thinking_response",
      payload: { agentId, level: "off" },
    });
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId, thinkingLevel: "off" });
    expect(manager.get(agentId)?.record.config?.thinkingOptionId).toBe("off");
    expect(saved.some((r) => r.id === agentId && r.config?.thinkingOptionId === "off")).toBe(true);
  });

  it("agent_set_thinking_request on a still-unspawned deferred draft pins the level, broadcasts, and responds — no throw (sprint-070)", async () => {
    const { service, ops, manager, broadcasts, saved } = makeSetup();
    const created = (await service.handleCreate(
      { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" } },
      () => [],
    )) as Record<string, unknown>;
    const agentId = (created.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.session).toBeNull();
    saved.length = 0;

    const result = (await ops.handleSetThinking({ agentId, level: "medium" }, () => [])) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({
      type: "agent_set_thinking_response",
      payload: { agentId, level: "medium" },
    });
    expect(broadcasts).toContainEqual({
      type: "agent_update",
      agentId,
      thinkingLevel: "medium",
    });
    expect(manager.get(agentId)?.record.config?.thinkingOptionId).toBe("medium");
    expect(saved.some((r) => r.id === agentId && r.config?.thinkingOptionId === "medium")).toBe(
      true,
    );
    expect(manager.get(agentId)?.session).toBeNull();
  });

  it("agent_set_thinking_request throws a clear unsupported error when setThinkingOption is absent", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(agentId, sessionStub());
    await expect(ops.handleSetThinking({ agentId, level: "high" }, () => [])).rejects.toThrow(
      /does not support/,
    );
  });

  it("agent_thinking_levels_request delegates to listThinkingLevels on a live session", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    manager.attachSession(
      agentId,
      sessionStub({ listThinkingLevels: () => Promise.resolve(["off", "low", "high"]) }),
    );
    const result = (await ops.handleThinkingLevels({ agentId })) as Record<string, unknown>;
    expect(result).toEqual({
      type: "agent_thinking_levels_response",
      payload: { agentId, levels: ["off", "low", "high"] },
    });
  });

  it("agent_thinking_levels_request on a draft throws 'no live session' (drafts answer from the catalogue client-side)", async () => {
    const { service, ops, manager } = makeSetup();
    const created = (await service.handleCreate(
      { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" } },
      () => [],
    )) as Record<string, unknown>;
    const agentId = (created.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.session).toBeNull();
    await expect(ops.handleThinkingLevels({ agentId })).rejects.toThrow(/no live session/);
  });

  it("agent_thinking_levels_request on an unknown agent throws (→ rpc_error)", async () => {
    const { ops } = makeSetup();
    await expect(ops.handleThinkingLevels({ agentId: "nope" })).rejects.toThrow(/unknown agent/);
  });

  it("agent_list_commands_request on a still-unspawned deferred draft lazily spawns and returns the mock's command list, instead of throwing 'has no live session' (web-client slash commands)", async () => {
    const { service, ops, manager } = makeSetup();
    // Deferred-draft creation: no `initialPrompt` means `handleCreate` persists the record but
    // never spawns a provider process (`agent-service.ts` `handleCreate`'s deferred branch) —
    // `managed.session` stays `null` exactly like a real "New chat" tab before anything is sent,
    // which is exactly the flow the `/` picker's first open needs to work in.
    const created = (await service.handleCreate(
      { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" } },
      () => [],
    )) as Record<string, unknown>;
    const agentId = (created.payload as Record<string, unknown>).agentId as string;
    expect(manager.get(agentId)?.session).toBeNull();

    const result = (await ops.handleListCommands({ agentId })) as Record<string, unknown>;

    const commands = (result.payload as Record<string, unknown>).commands as Array<{
      name: string;
    }>;
    expect(commands.map((c) => c.name)).toEqual([
      "session-name",
      "fix-tests",
      "skill:brave-search",
    ]);
    // The lazy spawn attaches a real session going forward, just like the first real send would.
    expect(manager.get(agentId)?.session).not.toBeNull();
  });
});

describe("agent_fork_request — post-fork resync (sprint-071/task-003)", () => {
  function makeResyncSetup(hydrate?: (handle: unknown) => TimelineRow[]) {
    const broadcasts: unknown[] = [];
    const manager = new AgentManager({
      home: "/unused",
      saveAgent: () => Promise.resolve(),
      loadAllAgents: () => Promise.resolve([]),
      now: () => NOW,
    });
    const client: AgentClient = {
      provider: "pi",
      capabilities: {},
      createSession: () => {
        throw new Error("not used");
      },
      resumeSession: () => {
        throw new Error("not used");
      },
      listModels: () => Promise.resolve([]),
      isAvailable: () => true,
      ...(hydrate ? { hydrateTimeline: hydrate } : {}),
    };
    const ops = new SlashCommandOperationsService({
      manager,
      resolveClient: () => client,
      broadcast: (_, m) => broadcasts.push(m),
    });
    return { manager, ops, broadcasts };
  }

  async function seedAgent(
    manager: AgentManager,
    agentId: string,
    session: AgentSession,
  ): Promise<void> {
    await manager.add({
      id: agentId,
      provider: "pi",
      cwd: "/work",
      createdAt: NOW,
      updatedAt: NOW,
      labels: {},
      lastStatus: "idle",
      config: {},
      timeline: [],
    });
    manager.attachSession(agentId, session);
    await manager.persistSessionHandle(agentId); // establish the PRE-fork handle
  }

  /** A session whose `describePersistence()` mutates on `fork()` — the real rebind Pi performs. */
  function forkingSession(
    forkedRows: TimelineRow[],
    overrides: Record<string, unknown> = {},
  ): AgentSession {
    let handle: { provider: string; nativeHandle: string } = {
      provider: "pi",
      nativeHandle: "/sessions/before.jsonl",
    };
    return sessionStub({
      describePersistence: () => handle,
      fork: (entryId: string) => {
        handle = { provider: "pi", nativeHandle: "/sessions/after.jsonl" };
        return Promise.resolve({ text: `forked:${entryId}`, cancelled: false });
      },
      ...overrides,
    }) as AgentSession & { __rows?: TimelineRow[] };
  }

  it("a fork that changes the handle resets the timeline and broadcasts agent_timeline_reset", async () => {
    const rows: TimelineRow[] = [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent },
    ];
    const { manager, ops, broadcasts } = makeResyncSetup(() => rows);
    const agentId = "fork-changed";
    await seedAgent(manager, agentId, forkingSession(rows));

    await ops.handleFork({ agentId, entryId: "e1" }, () => []);

    expect(getTimeline(agentId)?.allRows()).toEqual(rows);
    expect(broadcasts).toContainEqual({
      type: "agent_timeline_reset",
      agentId,
      reason: "fork",
    });
  });

  it("a fork whose hydration yields zero rows still resets and still broadcasts", async () => {
    const { manager, ops, broadcasts } = makeResyncSetup(() => []);
    const agentId = "fork-empty";
    seedTimeline(agentId, [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent },
    ]);
    await seedAgent(manager, agentId, forkingSession([]));

    await ops.handleFork({ agentId, entryId: "e1" }, () => []);

    expect(getTimeline(agentId)?.rowCount()).toBe(0);
    expect(broadcasts).toContainEqual({
      type: "agent_timeline_reset",
      agentId,
      reason: "fork",
    });
  });

  it("an extension-cancelled fork performs no reset and no broadcast", async () => {
    const { manager, ops, broadcasts } = makeResyncSetup(() => [
      { epoch: 9, seq: 9, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent },
    ]);
    const agentId = "fork-cancelled";
    const seedRows: TimelineRow[] = [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent },
    ];
    seedTimeline(agentId, seedRows);
    await seedAgent(
      manager,
      agentId,
      forkingSession([], { fork: () => Promise.resolve({ text: "", cancelled: true }) }),
    );

    const result = (await ops.handleFork({ agentId, entryId: "e1" }, () => [])) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ type: "agent_fork_response", payload: { text: "", cancelled: true } });
    expect(getTimeline(agentId)?.allRows()).toEqual(seedRows);
    expect(broadcasts).toHaveLength(0);
  });

  it("a mock-provider fork (no handle change) performs no reset and no broadcast", async () => {
    const { manager, ops, broadcasts } = makeResyncSetup();
    const agentId = "fork-mock-stub";
    const seedRows: TimelineRow[] = [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent },
    ];
    seedTimeline(agentId, seedRows);
    // `describePersistence()` returns the SAME handle before and after `fork()` — exactly the
    // mock provider's inert stub (its nativeHandle is derived from the session id, which fork
    // never touches).
    await seedAgent(
      manager,
      agentId,
      sessionStub({
        describePersistence: () => ({ provider: "mock", nativeHandle: "mock:stable" }),
        fork: (entryId: string) =>
          Promise.resolve({ text: `mock forked text for ${entryId}`, cancelled: false }),
      }),
    );

    await ops.handleFork({ agentId, entryId: "e1" }, () => []);

    expect(getTimeline(agentId)?.allRows()).toEqual(seedRows);
    expect(broadcasts).toHaveLength(0);
  });

  it("the success response is observably emitted after the reset + broadcast", async () => {
    const rows: TimelineRow[] = [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "turn_started" } as AgentStreamEvent },
    ];
    const order: string[] = [];
    const { manager } = makeResyncSetup();
    const agentId = "fork-ordering";
    const orderedOps = new SlashCommandOperationsService({
      manager,
      resolveClient: () => ({
        provider: "pi",
        capabilities: {},
        createSession: () => {
          throw new Error("not used");
        },
        resumeSession: () => {
          throw new Error("not used");
        },
        listModels: () => Promise.resolve([]),
        isAvailable: () => true,
        hydrateTimeline: () => {
          order.push("hydrate");
          return rows;
        },
      }),
      broadcast: (_, m) => order.push(`broadcast:${(m as { type: string }).type}`),
    });
    await seedAgent(manager, agentId, forkingSession(rows));

    await orderedOps.handleFork({ agentId, entryId: "e1" }, () => []);
    order.push("response resolved");

    expect(order).toEqual(["hydrate", "broadcast:agent_timeline_reset", "response resolved"]);
  });
});
