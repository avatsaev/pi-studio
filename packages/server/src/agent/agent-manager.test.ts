import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import {
  AgentManager,
  type AgentManagerDeps,
  type AgentUpdateBroadcast,
  InvalidAgentTransitionError,
  PARENT_AGENT_ID_LABEL,
} from "./agent-manager.js";

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
  it("reloads persisted agents without auto-resuming runtimes and runs the loop hook", async () => {
    const persisted = [record({ lastStatus: "idle" }), record({ lastStatus: "closed" })];
    const onRecoverLoops = vi.fn();
    const { mgr } = makeManager({
      loadAllAgents: () => Promise.resolve(persisted),
      onRecoverLoops,
    });

    const count = await mgr.recover();
    expect(count).toBe(2);
    for (const r of persisted) {
      const managed = mgr.get(r.id);
      expect(managed?.session).toBeNull(); // runtime not resumed
      expect(managed?.record.lastStatus).toBe(r.lastStatus); // already-resting status preserved as-is
    }
    expect(onRecoverLoops).toHaveBeenCalledOnce();
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
