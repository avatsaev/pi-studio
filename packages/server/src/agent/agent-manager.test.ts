import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import {
  AGENT_CLOSE_TIMEOUT_MS,
  AgentManager,
  type AgentManagerDeps,
  type AgentUpdateBroadcast,
  InvalidAgentTransitionError,
  PARENT_AGENT_ID_LABEL,
} from "./agent-manager.js";
import type { AgentSession } from "./provider-contract.js";

const NOW = "2026-06-11T12:00:00.000Z";

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: randomUUID(),
    provider: "mock",
    cwd: "/work",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "initializing",
    timeline: [],
    ...overrides,
  };
}

function makeManager(extra?: Partial<AgentManagerDeps>): {
  mgr: AgentManager;
  saved: AgentRecord[];
  updates: AgentUpdateBroadcast[];
} {
  const saved: AgentRecord[] = [];
  const mgr = new AgentManager({
    home: "/unused",
    saveAgent: (r) => {
      saved.push(r);
      return Promise.resolve();
    },
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
    ...extra,
  });
  const updates: AgentUpdateBroadcast[] = [];
  mgr.subscribe((u) => updates.push(u));
  return { mgr, saved, updates };
}

describe("transitions", () => {
  it("persists and broadcasts each state change", async () => {
    const { mgr, saved, updates } = makeManager();
    const agent = await mgr.add(record({ lastStatus: "initializing" }));
    await mgr.setStatus(agent.record.id, "idle");
    await mgr.setStatus(agent.record.id, "running");
    await mgr.setStatus(agent.record.id, "idle");

    expect(saved.map((r) => r.lastStatus)).toEqual(["initializing", "idle", "running", "idle"]);
    expect(updates.map((u) => u.status)).toEqual(["initializing", "idle", "running", "idle"]);
    expect(updates.every((u) => u.type === "agent_update" && u.agentId === agent.record.id)).toBe(
      true,
    );
  });

  it("rejects an invalid transition", async () => {
    const { mgr } = makeManager();
    const agent = await mgr.add(record({ lastStatus: "idle" }));
    await mgr.setStatus(agent.record.id, "closed");
    await expect(mgr.setStatus(agent.record.id, "running")).rejects.toBeInstanceOf(
      InvalidAgentTransitionError,
    );
  });

  // Regression: a provider failure (bad API key, quota exhausted, 403/429) parks the agent at
  // "error", and the user's way out is to fix the cause and send again — `runTurn` opens with
  // `setStatus(running)`. While `error` had no edge to `running`, that threw before the turn even
  // started, so every later message in the conversation came straight back as "failed to send".
  it("allows a retry straight out of error, so a failed turn never wedges the conversation", async () => {
    const { mgr } = makeManager();
    const agent = await mgr.add(record({ lastStatus: "idle" }));
    await mgr.setStatus(agent.record.id, "running");
    await mgr.setStatus(agent.record.id, "error");

    const retried = await mgr.setStatus(agent.record.id, "running");
    expect(retried.record.lastStatus).toBe("running");
    expect((await mgr.setStatus(agent.record.id, "idle")).record.lastStatus).toBe("idle");
  });
});

describe("updateRecord", () => {
  it("merges a field patch, persists it to disk, and does not broadcast", async () => {
    const { mgr, saved, updates } = makeManager();
    const agent = await mgr.add(record({ title: undefined, labels: { a: "1" } }));
    saved.length = 0;
    updates.length = 0;

    await mgr.updateRecord(agent.record.id, { title: "Renamed", labels: { a: "1", b: "2" } });

    expect(mgr.get(agent.record.id)?.record.title).toBe("Renamed");
    expect(mgr.get(agent.record.id)?.record.labels).toEqual({ a: "1", b: "2" });
    expect(saved.at(-1)?.title).toBe("Renamed");
    // Broadcasting an `agent_update` for a field patch is the caller's job (each RPC handler owns
    // its own WS broadcast shape/timing) — `updateRecord` only guarantees the disk write.
    expect(updates).toHaveLength(0);
  });

  it("throws for an unknown agent id", async () => {
    const { mgr } = makeManager();
    await expect(mgr.updateRecord("missing", { title: "x" })).rejects.toThrow("unknown agent");
  });
});

describe("literal status", () => {
  it("a parent's status is unaffected by a running child", async () => {
    const { mgr } = makeManager();
    const parent = await mgr.add(record({ lastStatus: "idle" }));
    const child = await mgr.add(
      record({ lastStatus: "idle", labels: { [PARENT_AGENT_ID_LABEL]: parent.record.id } }),
    );
    await mgr.setStatus(child.record.id, "running");

    expect(mgr.get(parent.record.id)?.record.lastStatus).toBe("idle");
    expect(mgr.get(child.record.id)?.record.lastStatus).toBe("running");
    expect(mgr.parentAgentId(child.record.id)).toBe(parent.record.id);
    expect(mgr.parentAgentId(parent.record.id)).toBeNull();
  });
});

describe("recover", () => {
  it("reloads persisted agents without auto-resuming runtimes", async () => {
    const persisted = [record({ lastStatus: "idle" }), record({ lastStatus: "closed" })];
    const { mgr } = makeManager({
      loadAllAgents: () => Promise.resolve(persisted),
    });

    const count = await mgr.recover();
    expect(count).toBe(2);
    for (const r of persisted) {
      const managed = mgr.get(r.id);
      expect(managed?.session).toBeNull(); // runtime not resumed
      expect(managed?.record.lastStatus).toBe(r.lastStatus); // already-resting status preserved as-is
    }
  });

  it("normalizes a 'running'/'initializing' record left by a mid-turn crash back to 'idle', and persists it", async () => {
    const persisted = [
      record({ lastStatus: "running" }),
      record({ lastStatus: "initializing" }),
      record({ lastStatus: "idle" }),
    ];
    const { mgr, saved } = makeManager({ loadAllAgents: () => Promise.resolve(persisted) });

    await mgr.recover();

    // A recovered record has no live session — "running"/"initializing" describe a state that
    // requires one, so recovery reconciles both down to "idle" (the same normalization
    // `archiveAgent` already applies for archived agents) instead of resurrecting a session the
    // UI shows as perpetually "working" with a Stop button that has nothing to interrupt.
    expect(mgr.get(persisted[0]!.id)?.record.lastStatus).toBe("idle");
    expect(mgr.get(persisted[1]!.id)?.record.lastStatus).toBe("idle");
    expect(mgr.get(persisted[2]!.id)?.record.lastStatus).toBe("idle"); // already idle, untouched

    // Only the two reconciled records are written back to disk — the already-idle one is not
    // rewritten (no change to persist).
    expect(saved).toHaveLength(2);
    expect(saved.map((r) => r.id).toSorted()).toEqual(
      [persisted[0]!.id, persisted[1]!.id].toSorted(),
    );
  });
});

describe("active list", () => {
  it("excludes archived agents", async () => {
    const { mgr } = makeManager();
    await mgr.add(record({ lastStatus: "idle" }));
    await mgr.add(record({ lastStatus: "closed", archivedAt: NOW }));
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.listAll()).toHaveLength(2);
  });
});

function fakeSession(): AgentSession {
  return {} as unknown as AgentSession;
}

describe("onSessionAttached hook (sprint-066/task-004)", () => {
  it("invokes the hook with the agent id and session on attachSession", async () => {
    const calls: { agentId: string; session: AgentSession }[] = [];
    const { mgr } = makeManager({
      onSessionAttached: (agentId, session) => calls.push({ agentId, session }),
    });
    const { record: rec } = await mgr.add(record());
    const session = fakeSession();

    mgr.attachSession(rec.id, session);

    expect(calls).toEqual([{ agentId: rec.id, session }]);
    expect(mgr.get(rec.id)?.session).toBe(session);
  });

  it("a manager constructed without the hook behaves exactly as before", async () => {
    const { mgr } = makeManager();
    const { record: rec } = await mgr.add(record());
    const session = fakeSession();

    expect(() => mgr.attachSession(rec.id, session)).not.toThrow();
    expect(mgr.get(rec.id)?.session).toBe(session);
  });

  it("a throwing hook is logged and does not prevent the session from being attached", async () => {
    const warn = vi.fn();
    const { mgr } = makeManager({
      onSessionAttached: () => {
        throw new Error("boom");
      },
      logger: { warn } as never,
    });
    const { record: rec } = await mgr.add(record());
    const session = fakeSession();

    expect(() => mgr.attachSession(rec.id, session)).not.toThrow();
    expect(mgr.get(rec.id)?.session).toBe(session);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ agentId: rec.id });
  });

  it("attaching to an unknown agent id is a no-op and never invokes the hook", () => {
    const hook = vi.fn();
    const { mgr } = makeManager({ onSessionAttached: hook });

    expect(() => mgr.attachSession("does-not-exist", fakeSession())).not.toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
});

type CloseWarn = (fields: { agentId: string; err: string }, message: string) => void;

function closableSession(close: () => Promise<void>): AgentSession {
  return { close } as unknown as AgentSession;
}

describe("closeAll (daemon shutdown)", () => {
  it("closes every live session at once, clears them, and is a no-op the second time", async () => {
    const { mgr } = makeManager();
    const a = await mgr.add(record());
    const b = await mgr.add(record());
    const withoutSession = await mgr.add(record());
    const closeA = vi.fn(() => Promise.resolve());
    const closeB = vi.fn(() => Promise.resolve());
    mgr.attachSession(a.record.id, closableSession(closeA));
    mgr.attachSession(b.record.id, closableSession(closeB));

    await mgr.closeAll();
    await mgr.closeAll();

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(mgr.get(a.record.id)?.session).toBeNull();
    expect(mgr.get(b.record.id)?.session).toBeNull();
    expect(mgr.get(withoutSession.record.id)?.session).toBeNull();
  });

  it("starts every close before awaiting any (they run at once)", async () => {
    const { mgr } = makeManager();
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const started: number[] = [];
    for (const [i, gate] of gates.entries()) {
      const agent = await mgr.add(record());
      mgr.attachSession(
        agent.record.id,
        closableSession(() => {
          started.push(i);
          return gate.promise;
        }),
      );
    }

    const done = mgr.closeAll();
    expect(started).toEqual([0, 1]);
    for (const gate of gates) gate.resolve();
    await done;
  });

  it("a failing close is logged and does not stop the others", async () => {
    const warn = vi.fn<CloseWarn>();
    const { mgr } = makeManager({ logger: { warn } as never });
    const bad = await mgr.add(record());
    const syncBad = await mgr.add(record());
    const good = await mgr.add(record());
    const closeGood = vi.fn(() => Promise.resolve());
    mgr.attachSession(
      bad.record.id,
      closableSession(() => Promise.reject(new Error("boom"))),
    );
    mgr.attachSession(
      syncBad.record.id,
      closableSession(() => {
        throw new Error("sync boom");
      }),
    );
    mgr.attachSession(good.record.id, closableSession(closeGood));

    await expect(mgr.closeAll()).resolves.toBeUndefined();

    expect(closeGood).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((call) => call[0].err).toSorted()).toEqual(["boom", "sync boom"]);
  });

  describe("with a close that never resolves", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds closeAll for the default 5 s limit and no longer", async () => {
      vi.useFakeTimers();
      const warn = vi.fn<CloseWarn>();
      const { mgr } = makeManager({ logger: { warn } as never });
      const hung = await mgr.add(record());
      const good = await mgr.add(record());
      const closeGood = vi.fn(() => Promise.resolve());
      mgr.attachSession(
        hung.record.id,
        closableSession(() => new Promise<void>(() => {})),
      );
      mgr.attachSession(good.record.id, closableSession(closeGood));

      let settled = false;
      const done = mgr.closeAll().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(AGENT_CLOSE_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      expect(closeGood).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(settled).toBe(true);
      expect(AGENT_CLOSE_TIMEOUT_MS).toBe(5000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0].err).toContain("timed out after 5000 ms");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe("runExclusive (one turn, compaction or session operation at a time)", () => {
  it("refuses a second claim with the reason of the first, and starts nothing for it", async () => {
    const { mgr } = makeManager();
    const agent = await mgr.add(record());
    const id = agent.record.id;
    const gate = Promise.withResolvers<void>();
    const second = vi.fn(() => Promise.resolve());

    const first = mgr.runExclusive(id, "turn", () => gate.promise);
    await expect(mgr.runExclusive(id, "turn", second)).rejects.toThrow(
      `busy: agent ${id} is running`,
    );
    await expect(mgr.runExclusive(id, "compaction", second)).rejects.toThrow(/busy.*is running/);
    expect(second).not.toHaveBeenCalled();

    gate.resolve();
    await first;
    await mgr.runExclusive(id, "compaction", () => Promise.resolve());
  });

  it.each([
    ["compaction", /busy.*is compacting/],
    ["session", /busy.*is changing its session/],
  ] as const)("names a held %s", async (kind, message) => {
    const { mgr } = makeManager();
    const id = (await mgr.add(record())).record.id;
    const gate = Promise.withResolvers<void>();
    const first = mgr.runExclusive(id, kind, () => gate.promise);
    await expect(mgr.runExclusive(id, "turn", () => Promise.resolve())).rejects.toThrow(message);
    gate.resolve();
    await first;
  });

  it("releases the claim when the work fails, and claims per agent", async () => {
    const { mgr } = makeManager();
    const a = (await mgr.add(record())).record.id;
    const b = (await mgr.add(record())).record.id;

    await expect(
      mgr.runExclusive(a, "turn", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(mgr.runExclusive(a, "turn", () => Promise.resolve("again"))).resolves.toBe(
      "again",
    );

    const gate = Promise.withResolvers<void>();
    const held = mgr.runExclusive(a, "turn", () => gate.promise);
    await expect(mgr.runExclusive(b, "turn", () => Promise.resolve("other"))).resolves.toBe(
      "other",
    );
    gate.resolve();
    await held;
  });
});
