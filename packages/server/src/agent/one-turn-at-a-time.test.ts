import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it, vi } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import { agentCalls } from "../test-support/answer-then-run.js";
import type { Session } from "../ws/session.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import { MOCK_CAPABILITIES } from "./providers/mock/mock-provider.js";
import type {
  AgentClient,
  AgentCompactResult,
  AgentSession,
  Unsubscribe,
} from "./provider-contract.js";
import { SessionOperationsService } from "./session-operations.js";
import { SlashCommandOperationsService } from "./slash-command-operations.js";

/**
 * One turn, compaction or session operation at a time per agent (sprint-149/task-003): a second
 * send, compaction or session operation is refused with `busy` while one runs, each stream event
 * is recorded and broadcast once, and `update_agent` no longer writes back a stale config.
 */

const NOW = "2026-11-25T12:00:00.000Z";
const COMPACTED: AgentCompactResult = { summary: "s", tokensBefore: 100, estimatedTokensAfter: 10 };

/** A session whose turn and compaction end only when the test says so. */
class GatedSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;
  readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  readonly turnGate = Promise.withResolvers<void>();
  readonly compactGate = Promise.withResolvers<AgentCompactResult>();
  runs = 0;
  readonly fork = vi.fn(() => Promise.resolve({ text: "", cancelled: true }));
  readonly clone = vi.fn(() => Promise.resolve({ cancelled: true }));
  readonly newSession = vi.fn(() => Promise.resolve({ cancelled: true }));
  readonly switchSession = vi.fn(() => Promise.resolve({ cancelled: true }));
  readonly setProviderModel = vi.fn(() => Promise.resolve({}));
  readonly setThinkingOption = vi.fn(() => Promise.resolve());
  readonly setModel = vi.fn((_id: string) => Promise.resolve());
  readonly compact = vi.fn(() => this.compactGate.promise);

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "t1" });
  }
  async run(): Promise<void> {
    this.runs++;
    this.emit({ kind: "turn_started" });
    await this.turnGate.promise;
    this.emit({ kind: "assistant_message", text: "reply" });
    this.emit({ kind: "turn_completed" });
  }
  interrupt(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  getRuntimeInfo() {
    return { provider: "mock" };
  }
  describePersistence() {
    return null;
  }
  private emit(event: AgentStreamEvent): void {
    for (const cb of this.subscribers) cb(event);
  }
}

async function setup() {
  const frames: Record<string, unknown>[] = [];
  const rec: AgentRecord = {
    id: randomUUID(),
    provider: "mock",
    cwd: "/work",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "idle",
  };
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([rec]),
    deleteAgent: () => Promise.resolve(true),
    now: () => NOW,
  });
  await manager.recover();
  const session = new GatedSession();
  manager.attachSession(rec.id, session);
  const broadcast = (_: Iterable<Session>, message: unknown): void => {
    frames.push(message as Record<string, unknown>);
  };
  const client = {
    resumeSession: () => Promise.reject(new Error("must not resume")),
  } as unknown as AgentClient;
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast,
    now: () => NOW,
  });
  const slash = new SlashCommandOperationsService({
    manager,
    resolveClient: () => client,
    broadcast,
  });
  const ops = new SessionOperationsService({
    manager,
    resolveClient: () => client,
    service,
    broadcast,
    now: () => NOW,
  });
  const streamKinds = (): string[] =>
    frames.flatMap((f) => {
      const inner = f.message as Record<string, unknown> | undefined;
      return inner?.type === "agent_stream" ? [(inner.event as AgentStreamEvent).kind] : [];
    });
  return {
    agentId: rec.id,
    manager,
    session,
    service,
    calls: agentCalls(service),
    slash,
    ops,
    streamKinds,
  };
}

describe("send while a turn runs", () => {
  it("runs one turn for two concurrent sends, refuses the other, and records every event once", async () => {
    const { agentId, manager, session, service, calls, streamKinds } = await setup();

    const first = calls.send({ agentId, prompt: "one" });
    const second = calls.send({ agentId, prompt: "two" });
    await expect(second).rejects.toThrow(`busy: agent ${agentId} is running`);

    session.turnGate.resolve();
    await first;
    await service.turnSettled(agentId);

    expect(session.runs).toBe(1);
    expect(session.subscribers.size).toBe(0);
    expect(streamKinds()).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
    expect(
      manager.timelines
        .get(agentId)
        ?.allRows()
        .map((r) => r.event.kind),
    ).toEqual(["user_message", "turn_started", "assistant_message", "turn_completed"]);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });

  it("accepts the next send once the turn has ended", async () => {
    const { agentId, session, calls } = await setup();
    session.turnGate.resolve();
    await calls.sendSettled({ agentId, prompt: "one" });
    await calls.sendSettled({ agentId, prompt: "two" });
    expect(session.runs).toBe(2);
  });

  it("releases the agent when the run rejects outright", async () => {
    const { agentId, manager, session, calls } = await setup();
    session.run = () => Promise.reject(new Error("boom"));
    await calls.sendSettled({ agentId, prompt: "one" });
    expect(manager.get(agentId)?.record.lastStatus).toBe("error");
    session.run = () => Promise.resolve();
    await calls.sendSettled({ agentId, prompt: "two" });
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });
});

describe("send during a compaction", () => {
  it("is refused with busy, and the compaction still completes", async () => {
    const { agentId, session, calls, slash } = await setup();

    const compaction = slash.handleCompact({ agentId }, () => []);
    await vi.waitFor(() => expect(session.compact).toHaveBeenCalledTimes(1));
    await expect(calls.send({ agentId, prompt: "go" })).rejects.toThrow(
      `busy: agent ${agentId} is compacting`,
    );
    expect(session.runs).toBe(0);

    session.compactGate.resolve(COMPACTED);
    await compaction;
  });
});

describe("session operations while a turn runs", () => {
  it("refuses fork, clone, new session, switch and resume with busy, and runs none of them", async () => {
    const { agentId, session, service, calls, slash, ops } = await setup();
    await calls.send({ agentId, prompt: "one" });

    const refused = [
      slash.handleFork({ agentId, entryId: "e1" }, () => []),
      slash.handleClone({ agentId }, () => []),
      slash.handleNewSession({ agentId }, () => []),
      slash.handleSwitchSession({ agentId, sessionPath: "/s.jsonl" }, () => []),
      slash.handleCompact({ agentId }, () => []),
      ops.handleResume({ agentId }, () => []),
    ];
    for (const call of refused) {
      await expect(call).rejects.toThrow(`busy: agent ${agentId} is running`);
    }
    expect(session.fork).not.toHaveBeenCalled();
    expect(session.clone).not.toHaveBeenCalled();
    expect(session.newSession).not.toHaveBeenCalled();
    expect(session.switchSession).not.toHaveBeenCalled();
    expect(session.compact).not.toHaveBeenCalled();

    session.turnGate.resolve();
    await service.turnSettled(agentId);
    await slash.handleFork({ agentId, entryId: "e1" }, () => []);
    expect(session.fork).toHaveBeenCalledTimes(1);
  });

  it("lets model and thinking-level changes through", async () => {
    const { agentId, session, service, calls, slash } = await setup();
    await calls.send({ agentId, prompt: "one" });

    await slash.handleSetModel({ agentId, provider: "anthropic", modelId: "m1" }, () => []);
    await slash.handleSetThinking({ agentId, level: "high" }, () => []);

    expect(session.setProviderModel).toHaveBeenCalledWith("anthropic", "m1");
    expect(session.setThinkingOption).toHaveBeenCalledWith("high");
    session.turnGate.resolve();
    await service.turnSettled(agentId);
  });
});

describe("session operation in progress", () => {
  it("refuses a send until the fork has finished", async () => {
    const { agentId, session, calls, slash } = await setup();
    const forkGate = Promise.withResolvers<{ text: string; cancelled: boolean }>();
    session.fork.mockReturnValueOnce(forkGate.promise);

    const fork = slash.handleFork({ agentId, entryId: "e1" }, () => []);
    await expect(calls.send({ agentId, prompt: "go" })).rejects.toThrow(
      /busy.*is changing its session/,
    );

    forkGate.resolve({ text: "", cancelled: true });
    await fork;
  });
});

describe("update_agent", () => {
  it("merges into the record after its awaits, so a concurrent config change survives", async () => {
    const { agentId, manager, session, ops } = await setup();
    const modelGate = Promise.withResolvers<void>();
    session.setModel.mockReturnValueOnce(modelGate.promise);

    const update = ops.handleUpdate({ agentId, model: "m2", title: "Renamed" }, () => []);
    await vi.waitFor(() => expect(session.setModel).toHaveBeenCalledWith("m2"));
    await manager.updateRecord(agentId, {
      config: { model: "m3", modelProvider: "anthropic", thinkingOptionId: "high" },
    });
    modelGate.resolve();
    await update;

    const record = manager.get(agentId)?.record;
    expect(record?.title).toBe("Renamed");
    expect(record?.config).toMatchObject({
      model: "m3",
      modelProvider: "anthropic",
      thinkingOptionId: "high",
    });
  });

  it("rejects when the agent was deleted during its awaits", async () => {
    const { agentId, manager, session, ops } = await setup();
    const modelGate = Promise.withResolvers<void>();
    session.setModel.mockReturnValueOnce(modelGate.promise);

    const update = ops.handleUpdate({ agentId, model: "m2" }, () => []);
    await vi.waitFor(() => expect(session.setModel).toHaveBeenCalled());
    await manager.deleteAgent(agentId);
    modelGate.resolve();

    await expect(update).rejects.toThrow(`unknown agent: ${agentId}`);
  });
});
