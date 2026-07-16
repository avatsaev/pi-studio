import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import {
  AgentManager,
  type AgentManagerDeps,
  type AgentManagerEvent,
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
    lastStatus: "idle",
    timeline: [],
    ...overrides,
  };
}

function makeManager(extra?: Partial<AgentManagerDeps>): {
  mgr: AgentManager;
  events: AgentManagerEvent[];
} {
  const mgr = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
    ...extra,
  });
  const events: AgentManagerEvent[] = [];
  mgr.subscribe((e) => events.push(e));
  return { mgr, events };
}

function fakeSession(): AgentSession & { closeSpy: ReturnType<typeof vi.fn> } {
  const closeSpy = vi.fn(() => Promise.resolve());
  return {
    closeSpy,
    close: closeSpy,
    describePersistence: () => ({ provider: "mock", sessionId: "s", nativeHandle: "mock:s" }),
  } as unknown as AgentSession & { closeSpy: ReturnType<typeof vi.fn> };
}

describe("archive cascade", () => {
  it("cascades to all parent-linked non-detached children recursively; detached survives", async () => {
    const { mgr, events } = makeManager();
    const parent = (await mgr.add(record())).record;
    const child1 = (await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: parent.id } })))
      .record;
    const child2 = (await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: parent.id } })))
      .record;
    const grandchild = (await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: child1.id } })))
      .record;
    const detached = (await mgr.add(record())).record; // no parent label

    await mgr.archiveAgent(parent.id);

    for (const id of [parent.id, child1.id, child2.id, grandchild.id]) {
      expect(mgr.get(id)?.record.archivedAt).toBe(NOW);
    }
    expect(mgr.get(detached.id)?.record.archivedAt).toBeUndefined();

    const archivedIds = events
      .filter((e) => e.type === "agent_archived")
      .map((e) => (e.type === "agent_archived" ? e.agentId : ""));
    expect(new Set(archivedIds)).toEqual(new Set([parent.id, child1.id, child2.id, grandchild.id]));
  });

  it("archiving a running agent closes/kills its runtime and normalizes lastStatus", async () => {
    const { mgr } = makeManager();
    const agent = (await mgr.add(record({ lastStatus: "idle" }))).record;
    await mgr.setStatus(agent.id, "running");
    const session = fakeSession();
    mgr.attachSession(agent.id, session);

    await mgr.archiveAgent(agent.id);

    expect(session.closeSpy).toHaveBeenCalledOnce();
    expect(mgr.get(agent.id)?.session).toBeNull();
    expect(mgr.get(agent.id)?.record.lastStatus).toBe("closed");
    // Persistence handle snapshotted from the session.
    expect(mgr.get(agent.id)?.record.persistence?.nativeHandle).toBe("mock:s");
  });

  it("excludes archived agents from the active list but keeps them on disk (listAll)", async () => {
    const saved: AgentRecord[] = [];
    const { mgr } = makeManager({
      saveAgent: (r) => {
        saved.push(r);
        return Promise.resolve();
      },
    });
    const a = (await mgr.add(record())).record;
    await mgr.add(record());
    await mgr.archiveAgent(a.id);

    expect(mgr.list()).toHaveLength(1);
    expect(mgr.listAll()).toHaveLength(2);
    // The archived record was persisted with archivedAt (still on disk).
    expect(saved.some((r) => r.id === a.id && r.archivedAt === NOW)).toBe(true);
  });

  it("is idempotent (archiving twice does not re-cascade)", async () => {
    const { mgr, events } = makeManager();
    const parent = (await mgr.add(record())).record;
    await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: parent.id } }));
    await mgr.archiveAgent(parent.id);
    const archivedCount1 = events.filter((e) => e.type === "agent_archived").length;
    await mgr.archiveAgent(parent.id);
    const archivedCount2 = events.filter((e) => e.type === "agent_archived").length;
    expect(archivedCount2).toBe(archivedCount1);
  });
});

describe("deleteAgent", () => {
  it("removes the agent from disk and memory, and returns true", async () => {
    const deleted: string[] = [];
    const { mgr } = makeManager({
      deleteAgent: (_cwd, id) => {
        deleted.push(id);
        return Promise.resolve(true);
      },
    });
    const agent = (await mgr.add(record())).record;

    const result = await mgr.deleteAgent(agent.id);

    expect(result).toBe(true);
    expect(deleted).toEqual([agent.id]);
    expect(mgr.get(agent.id)).toBeUndefined();
    expect(mgr.list()).toHaveLength(0);
    expect(mgr.listAll()).toHaveLength(0);
  });

  it("returns false and is a no-op for an unknown agent id", async () => {
    const { mgr } = makeManager();
    const result = await mgr.deleteAgent("nonexistent");
    expect(result).toBe(false);
  });

  it("closes a live runtime before deleting", async () => {
    const { mgr } = makeManager();
    const agent = (await mgr.add(record())).record;
    const session = fakeSession();
    mgr.attachSession(agent.id, session);

    await mgr.deleteAgent(agent.id);

    expect(session.closeSpy).toHaveBeenCalledOnce();
  });

  it("cascades to all parent-linked non-detached children recursively; detached survives", async () => {
    const { mgr, events } = makeManager();
    const parent = (await mgr.add(record())).record;
    const child1 = (await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: parent.id } })))
      .record;
    const child2 = (await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: parent.id } })))
      .record;
    const grandchild = (await mgr.add(record({ labels: { [PARENT_AGENT_ID_LABEL]: child1.id } })))
      .record;
    const detached = (await mgr.add(record())).record; // no parent label

    await mgr.deleteAgent(parent.id);

    for (const id of [parent.id, child1.id, child2.id, grandchild.id]) {
      expect(mgr.get(id)).toBeUndefined();
    }
    expect(mgr.get(detached.id)).toBeDefined();

    const deletedIds = events
      .filter((e) => e.type === "agent_deleted")
      .map((e) => (e.type === "agent_deleted" ? e.agentId : ""));
    expect(new Set(deletedIds)).toEqual(new Set([parent.id, child1.id, child2.id, grandchild.id]));
  });

  it("is idempotent (deleting an already-deleted agent is a no-op, no extra broadcast)", async () => {
    const { mgr, events } = makeManager();
    const agent = (await mgr.add(record())).record;
    await mgr.deleteAgent(agent.id);
    const deletedCount1 = events.filter((e) => e.type === "agent_deleted").length;
    const secondResult = await mgr.deleteAgent(agent.id);
    const deletedCount2 = events.filter((e) => e.type === "agent_deleted").length;
    expect(secondResult).toBe(false);
    expect(deletedCount2).toBe(deletedCount1);
  });
});
