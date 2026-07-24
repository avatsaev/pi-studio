import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { SessionOperationsService } from "./session-operations.js";

const NOW = "2026-06-11T12:00:00.000Z";

function makeSetup(): {
  manager: AgentManager;
  service: AgentService;
  ops: SessionOperationsService;
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
  const ops = new SessionOperationsService({
    manager,
    resolveClient: () => client,
    service,
    broadcast: (_, m) => broadcasts.push(m),
    now: () => NOW,
  });
  return { manager, service, ops, broadcasts, saved };
}

async function createAgent(service: AgentService, prompt?: string): Promise<string> {
  const result = (await service.handleCreate(
    { requestId: randomUUID(), config: { provider: "mock", cwd: "/work" }, initialPrompt: prompt },
    () => [],
  )) as Record<string, unknown>;
  return (result.payload as Record<string, unknown>).agentId as string;
}

describe("interrupt", () => {
  it("interrupts a running turn → turn_canceled → idle via ops.handleInterrupt", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service);
    // Force agent to running so interrupt has something to do.
    await manager.setStatus(agentId, "running");
    const result = (await ops.handleInterrupt({ agentId }, () => [])) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
  });

  it("session.interrupt yields turn_canceled when a turn is active", async () => {
    const { service, manager } = makeSetup();
    const agentId = await createAgent(service, "first"); // a completed turn
    const managed = manager.get(agentId)!;
    const events: string[] = [];
    managed.session!.subscribe((e) => events.push(e.kind));
    // Start a new turn without awaiting it, then interrupt.
    void managed.session!.startTurn("slow task");
    await managed.session!.interrupt();
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain("turn_canceled");
  });

  it("self-heals a stuck 'running' record with no live session (e.g. after a daemon restart the boot-recovery reconciliation missed, or an agent stuck before this fix)", async () => {
    const { service, ops, manager, broadcasts } = makeSetup();
    const agentId = await createAgent(service, "first");
    const managed = manager.get(agentId)!;
    // Simulate the state a mid-turn crash + un-reconciled restart would leave: no live session,
    // but the record still claims "running" — exactly what left Stop unable to do anything.
    managed.session = null;
    await manager.setStatus(agentId, "idle"); // legal step so the next transition is valid…
    managed.record = { ...managed.record, lastStatus: "running" }; // …then force the stuck state

    const result = (await ops.handleInterrupt({ agentId }, () => [])) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(manager.get(agentId)?.record.lastStatus).toBe("idle");
    expect(broadcasts).toContainEqual({ type: "agent_update", agentId, status: "idle" });
  });

  it("no-ops (ok: false) when there is no session and the record is already resting", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service, "first");
    manager.get(agentId)!.session = null;
    await manager.setStatus(agentId, "idle");
    const result = (await ops.handleInterrupt({ agentId }, () => [])) as Record<string, unknown>;
    expect(result.ok).toBe(false);
  });
});

describe("update agent", () => {
  it("updates title and labels without recreating the session", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service, "first");
    const before = manager.get(agentId)!.session;
    await ops.handleUpdate({ agentId, title: "New Title", labels: { tag: "sprint" } }, () => []);
    expect(manager.get(agentId)?.record.title).toBe("New Title");
    expect(manager.get(agentId)?.record.labels.tag).toBe("sprint");
    // Session object is unchanged (not recreated).
    expect(manager.get(agentId)?.session).toBe(before);
  });

  it("actually persists the new title to disk, not just the in-memory record", async () => {
    const { service, ops, saved } = makeSetup();
    const agentId = await createAgent(service, "first");
    saved.length = 0; // drop the initial creation write
    await ops.handleUpdate({ agentId, title: "Renamed" }, () => []);
    expect(saved.some((r) => r.id === agentId && r.title === "Renamed")).toBe(true);
  });
});

describe("resume", () => {
  it("resumes a closed agent via its persistence handle", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service, "first");
    // Simulate the agent being closed (no live session).
    const managedAgent = manager.get(agentId)!;
    managedAgent.record = {
      ...managedAgent.record,
      persistence: {
        provider: "mock",
        sessionId: "s1",
        nativeHandle: "mock:s1",
      } as AgentRecord["persistence"],
    };
    managedAgent.session = null;
    await manager.setStatus(agentId, "error");
    await manager.setStatus(agentId, "closed");
    // Force idle for test (closed → idle normally requires a new session).
    managedAgent.record = { ...managedAgent.record, lastStatus: "idle" };
    managedAgent.session = null;

    const result = (await ops.handleResume({ agentId }, () => [])) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    const resumed = manager.get(agentId)?.session;
    expect(resumed).not.toBeNull();
    // Regression: resume must carry the agent's original cwd, not fall back to "." (the daemon's
    // own cwd) — a lost cwd on resume made the agent silently answer questions like "what is
    // your pwd?" from the wrong directory after a daemon restart.
    expect(resumed?.getRuntimeInfo().extra?.cwd).toBe("/work");
  });

  it("throws rpc_error on a stale handle (no persistence)", async () => {
    const { service, ops, manager } = makeSetup();
    const agentId = await createAgent(service, "first");
    manager.get(agentId)!.record = { ...manager.get(agentId)!.record, persistence: undefined };
    await expect(ops.handleResume({ agentId }, () => [])).rejects.toThrow("stale");
  });
});

describe("import", () => {
  it("seeds the timeline before publishing the agent", async () => {
    const { ops, manager } = makeSetup();
    const result = (await ops.handleImport(
      { provider: "mock", cwd: "/work", providerHandleId: "mock:imported" },
      () => [],
    )) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    const agentId = result.agentId as string;
    const managed = manager.get(agentId);
    expect(typeof managed?.record.persistence?.nativeHandle).toBe("string");
    expect(managed?.session).not.toBeNull();
  });
});

describe("send prompt", () => {
  it("lazily resumes from the persistence handle when no live session exists (post-restart)", async () => {
    const { service, manager } = makeSetup();
    const agentId = await createAgent(service, "first");

    // Simulate a daemon restart: the record survives on disk but the runtime session is gone
    // (agent-manager.ts#recover — "runtime is NOT auto-resumed").
    const managedAgent = manager.get(agentId)!;
    managedAgent.record = {
      ...managedAgent.record,
      persistence: {
        provider: "mock",
        sessionId: "s1",
        nativeHandle: "mock:s1",
      } as AgentRecord["persistence"],
    };
    managedAgent.session = null;

    const result = (await service.handleSendPrompt(
      { agentId, prompt: "second" },
      () => [],
    )) as Record<string, unknown>;
    expect(result.status).toBe("idle");
    const resumed = manager.get(agentId)?.session;
    expect(resumed).not.toBeNull();
    // Regression: lazy resume on send must also carry the record's cwd.
    expect(resumed?.getRuntimeInfo().extra?.cwd).toBe("/work");
  });

  it("throws when no live session and no persistence handle exists", async () => {
    const { service, manager } = makeSetup();
    const agentId = await createAgent(service, "first");
    const managedAgent = manager.get(agentId)!;
    managedAgent.record = { ...managedAgent.record, persistence: undefined };
    managedAgent.session = null;

    await expect(service.handleSendPrompt({ agentId, prompt: "second" }, () => [])).rejects.toThrow(
      "no live session",
    );
  });
});
