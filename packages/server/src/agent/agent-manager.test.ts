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
    const persisted = [record({ lastStatus: "running" }), record({ lastStatus: "idle" })];
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
      expect(managed?.record.lastStatus).toBe(r.lastStatus); // record preserved as-is
    }
    expect(onRecoverLoops).toHaveBeenCalledOnce();
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
