import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it, vi } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Session } from "../ws/session.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { MOCK_CAPABILITIES, MockAgentSession } from "./providers/mock/mock-provider.js";
import type {
  AgentClient,
  AgentCompactResult,
  AgentSession,
  Unsubscribe,
} from "./provider-contract.js";
import { SlashCommandOperationsService } from "./slash-command-operations.js";
import type { TimelineRow } from "./timeline-store.js";

/**
 * `agent_compact_request` (sprint-074 task-003): the busy guards, the resume of a process-less
 * record, the subscription window that records `compaction` events outside a turn, and the
 * synthetic terminal. Agent ids are random because the timeline map in `agent-service.ts` is
 * module-global.
 */

const NOW = "2026-10-09T12:00:00.000Z";

type CompactImpl = (emit: (event: AgentStreamEvent) => void) => Promise<AgentCompactResult>;

/** A session whose `compact()` is scripted by the test; everything else is inert. */
class ScriptedSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;
  compactCalls = 0;
  readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  compact?: (instructions?: string) => Promise<AgentCompactResult>;

  constructor(impl?: CompactImpl) {
    if (impl) {
      this.compact = () => {
        this.compactCalls++;
        return impl((event) => {
          for (const cb of this.subscribers) cb(event);
        });
      };
    }
  }

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}
  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "t1" });
  }
  run(): Promise<void> {
    return Promise.resolve();
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
  getAvailableModes() {
    return [];
  }
  getCurrentMode() {
    return null;
  }
  setMode(): Promise<void> {
    return Promise.resolve();
  }
  getPendingPermissions() {
    return [];
  }
  respondToPermission(): Promise<void> {
    return Promise.resolve();
  }
  describePersistence() {
    return null;
  }
}

function started(id: string): AgentStreamEvent {
  return { kind: "compaction", compactionId: id, phase: "started", reason: "manual" };
}

function completed(id: string): AgentStreamEvent {
  return {
    kind: "compaction",
    compactionId: id,
    phase: "completed",
    reason: "manual",
    tokensBefore: 100,
    estimatedTokensAfter: 10,
    summary: "s",
  };
}

const OK: AgentCompactResult = { summary: "s", tokensBefore: 100, estimatedTokensAfter: 10 };

function record(extra: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: randomUUID(),
    provider: "mock",
    cwd: "/work",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "idle",
    timeline: [],
    ...extra,
  };
}

interface Setup {
  manager: AgentManager;
  ops: SlashCommandOperationsService;
  agentId: string;
  active: Session[];
  frames: { sessions: Iterable<Session>; message: Record<string, unknown> }[];
  streamEvents: () => AgentStreamEvent[];
}

async function setup(
  rec: AgentRecord,
  client: AgentClient = { resumeSession: () => Promise.reject(new Error("no client")) } as never,
): Promise<Setup> {
  const frames: Setup["frames"] = [];
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([rec]),
    now: () => NOW,
  });
  await manager.recover();
  const broadcast = (sessions: Iterable<Session>, message: unknown): void => {
    frames.push({ sessions, message: message as Record<string, unknown> });
  };
  const ops = new SlashCommandOperationsService({
    manager,
    resolveClient: () => client,
    broadcast,
  });
  const active: Session[] = [];
  return {
    manager,
    ops,
    agentId: rec.id,
    active,
    frames,
    streamEvents: () =>
      frames.flatMap(({ message }) => {
        const inner = message.message as Record<string, unknown> | undefined;
        return inner?.type === "agent_stream" ? [inner.event as AgentStreamEvent] : [];
      }),
  };
}

function compactionRows(agentId: string): AgentStreamEvent[] {
  return (getTimeline(agentId)?.allRows() ?? [])
    .map((r) => r.event)
    .filter((e) => e.kind === "compaction");
}

describe("agent_compact_request — recording", () => {
  it("appends started + completed to the timeline and broadcasts both to the active sessions", async () => {
    const rec = record();
    const { manager, ops, agentId, active, frames } = await setup(rec);
    manager.attachSession(
      agentId,
      new MockAgentSession({ provider: "mock", cwd: "/work" }, { compactDelayMs: 0 }),
    );

    const result = (await ops.handleCompact({ agentId }, () => active)) as Record<string, unknown>;

    const rows = compactionRows(agentId);
    expect(rows.map((e) => e.kind === "compaction" && e.phase)).toEqual(["started", "completed"]);
    const streamFrames = frames
      .map((f) => ({ sessions: f.sessions, inner: f.message.message as Record<string, unknown> }))
      .filter((f) => f.inner?.type === "agent_stream");
    expect(streamFrames).toHaveLength(2);
    for (const f of streamFrames) {
      expect(f.sessions).toBe(active);
      expect(f.inner.agentId).toBe(agentId);
      expect(typeof f.inner.seq).toBe("number");
      expect(typeof f.inner.timestamp).toBe("string");
    }
    expect(streamFrames[0]?.inner.seq).toBeLessThan(streamFrames[1]?.inner.seq as number);
    expect(result.payload).toMatchObject({ estimatedTokensAfter: 14_000 });
    expect(frames.map((f) => f.message)).toContainEqual({
      type: "agent_update",
      agentId,
      compacted: true,
    });
  });

  it("forwards only compaction events, not other events emitted during the call", async () => {
    const { manager, ops, agentId, active } = await setup(record());
    manager.attachSession(
      agentId,
      new ScriptedSession(async (emit) => {
        emit({ kind: "assistant_message", text: "noise" });
        emit(started("c1"));
        emit(completed("c1"));
        return OK;
      }),
    );
    await ops.handleCompact({ agentId }, () => active);
    const kinds = (getTimeline(agentId)?.allRows() ?? []).map((r) => r.event.kind);
    expect(kinds).toEqual(["compaction", "compaction"]);
  });
});

describe("agent_compact_request — guards", () => {
  it("rejects with busy on a running agent and never calls session.compact", async () => {
    const { manager, ops, agentId, active } = await setup(record());
    const session = new ScriptedSession(() => Promise.resolve(OK));
    manager.attachSession(agentId, session);
    await manager.setStatus(agentId, "running");

    await expect(ops.handleCompact({ agentId }, () => active)).rejects.toThrow(/busy.*is running/);
    expect(session.compactCalls).toBe(0);
  });

  it("rejects a second request while one is in flight, and the first still completes", async () => {
    const { manager, ops, agentId, active } = await setup(record());
    const gate = Promise.withResolvers<AgentCompactResult>();
    const session = new ScriptedSession(async (emit) => {
      emit(started("c1"));
      const result = await gate.promise;
      emit(completed("c1"));
      return result;
    });
    manager.attachSession(agentId, session);

    const first = ops.handleCompact({ agentId }, () => active);
    await vi.waitFor(() => expect(session.compactCalls).toBe(1));
    await expect(ops.handleCompact({ agentId }, () => active)).rejects.toThrow(
      /busy.*already compacting/,
    );
    expect(session.compactCalls).toBe(1);

    gate.resolve(OK);
    expect(((await first) as Record<string, unknown>).payload).toEqual(OK);
    expect(compactionRows(agentId).map((e) => e.kind === "compaction" && e.phase)).toEqual([
      "started",
      "completed",
    ]);
  });

  it("releases the in-flight slot after success, a rejecting compact, an unsupported provider and a failed resume", async () => {
    const outcomes: { name: string; prepare: (s: Setup) => void; expected: RegExp | null }[] = [
      {
        name: "success",
        prepare: (s) =>
          s.manager.attachSession(s.agentId, new ScriptedSession(() => Promise.resolve(OK))),
        expected: null,
      },
      {
        name: "rejecting compact",
        prepare: (s) =>
          s.manager.attachSession(
            s.agentId,
            new ScriptedSession(() => Promise.reject(new Error("boom"))),
          ),
        expected: /boom/,
      },
      {
        name: "unsupported",
        prepare: (s) => s.manager.attachSession(s.agentId, new ScriptedSession()),
        expected: /does not support 'compact'/,
      },
      { name: "resume failure", prepare: () => {}, expected: /no client/ },
    ];

    for (const { name, prepare, expected } of outcomes) {
      const s = await setup(
        record({ persistence: { provider: "mock", sessionId: "s", nativeHandle: "h" } }),
      );
      prepare(s);
      const first = s.ops.handleCompact({ agentId: s.agentId }, () => s.active);
      if (expected) await expect(first, name).rejects.toThrow(expected);
      else await first;
      // A leaked slot would turn the retry into a `busy` rejection.
      const retry = s.ops.handleCompact({ agentId: s.agentId }, () => s.active);
      await retry.then(
        () => {},
        (err: unknown) => expect(String(err), name).not.toMatch(/busy/),
      );
    }
  });
});

describe("agent_compact_request — process-less record", () => {
  it("resumes the session, seeds history from hydration, then appends the compaction rows", async () => {
    const history: TimelineRow[] = [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "user_message", text: "hello" } },
      { epoch: 1, seq: 1, timestamp: NOW, event: { kind: "turn_started" } },
      { epoch: 1, seq: 2, timestamp: NOW, event: { kind: "assistant_message", text: "hi" } },
      { epoch: 1, seq: 3, timestamp: NOW, event: { kind: "turn_completed" } },
    ];
    const session = new ScriptedSession(async (emit) => {
      emit(started("c1"));
      emit(completed("c1"));
      return OK;
    });
    const resumeSession = vi.fn(() => Promise.resolve(session));
    const client = {
      provider: "mock",
      resumeSession,
      hydrateTimeline: () => history,
    } as unknown as AgentClient;
    const s = await setup(
      record({ persistence: { provider: "mock", sessionId: "s", nativeHandle: "h" } }),
      client,
    );
    expect(getTimeline(s.agentId)).toBeUndefined();

    await s.ops.handleCompact({ agentId: s.agentId }, () => s.active);

    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(s.manager.get(s.agentId)?.session).toBe(session);
    expect((getTimeline(s.agentId)?.allRows() ?? []).map((r) => r.event.kind)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
      "compaction",
      "compaction",
    ]);
  });
});

describe("agent_compact_request — synthetic terminal", () => {
  it("records a failed row with the same id when compact rejects after started and nothing else", async () => {
    const { manager, ops, agentId, active } = await setup(record());
    manager.attachSession(
      agentId,
      new ScriptedSession(async (emit) => {
        emit(started("c1"));
        throw new Error("transport closed");
      }),
    );

    await expect(ops.handleCompact({ agentId }, () => active)).rejects.toThrow(/transport closed/);

    expect(compactionRows(agentId)).toEqual([
      started("c1"),
      { kind: "compaction", compactionId: "c1", phase: "failed", error: "transport closed" },
    ]);
  });

  it("adds no duplicate when the provider already emitted its own failed terminal", async () => {
    const { manager, ops, agentId, active } = await setup(record());
    manager.attachSession(
      agentId,
      new ScriptedSession(async (emit) => {
        emit(started("c1"));
        emit({
          kind: "compaction",
          compactionId: "c1",
          phase: "failed",
          error: "Already compacted",
        });
        throw new Error("Already compacted");
      }),
    );

    await expect(ops.handleCompact({ agentId }, () => active)).rejects.toThrow(/Already compacted/);

    expect(compactionRows(agentId).map((e) => e.kind === "compaction" && e.phase)).toEqual([
      "started",
      "failed",
    ]);
  });
});

describe("compaction during a turn (automatic path)", () => {
  it("runTurn records compaction events — including failed — and the agent still ends idle", async () => {
    const rec = record();
    const { manager, agentId } = await setup(rec);
    const session = new ScriptedSession();
    session.run = async () => {
      for (const cb of session.subscribers) {
        cb({ kind: "turn_started" });
        cb(started("auto-1"));
        cb({
          kind: "compaction",
          compactionId: "auto-1",
          phase: "failed",
          reason: "threshold",
          error: "summariser unavailable",
        });
        cb({ kind: "turn_completed" });
      }
    };
    manager.attachSession(agentId, session);
    const frames: unknown[] = [];
    const service = new AgentService({
      manager,
      resolveClient: () => ({}) as AgentClient,
      broadcast: (_, m) => frames.push(m),
      now: () => NOW,
    });

    await service.runTurn(agentId, session, "go", () => []);

    expect(compactionRows(agentId).map((e) => e.kind === "compaction" && e.phase)).toEqual([
      "started",
      "failed",
    ]);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });
});
