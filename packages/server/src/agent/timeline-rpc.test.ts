import { describe, expect, it } from "vitest";

import { AgentManager } from "./agent-manager.js";
import type { AgentClient } from "./provider-contract.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { TimelineRow } from "./timeline-store.js";
import { registerTimelineHandler } from "./timeline-rpc.js";
import { HandlerRegistry } from "../ws/router.js";

const NOW = "2026-06-11T12:00:00.000Z";

/**
 * Simulates the real-world gap this handler fixes: an agent record with a persisted
 * `persistence` handle, but NO in-memory `AgentTimelineStore` for its id — exactly the state every
 * agent is in immediately after a daemon restart (`agent-service.ts`'s timeline map is
 * process-memory only). `getTimeline(agentId)` will genuinely return `undefined` here because this
 * agentId was never passed through `AgentService.runTurn`/`getOrCreateTimeline` in this process.
 */
async function makeRestartedAgentManager(record: AgentRecord): Promise<AgentManager> {
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([record]),
    now: () => NOW,
  });
  await manager.recover(); // rehydrates the record only — no session, no in-memory timeline
  return manager;
}

function fakeCtx(agentId: string): { message: Record<string, unknown>; requestId: string; session: null } {
  return { message: { agentId, direction: "after" }, requestId: "r1", session: null };
}

describe("fetch_agent_timeline_request — restart hydration fallback", () => {
  it("rehydrates from the provider's hydrateTimeline() when no in-memory timeline exists", async () => {
    const rows: TimelineRow[] = [
      { epoch: 1, seq: 0, timestamp: NOW, event: { kind: "user_message", text: "hello" } },
      { epoch: 1, seq: 1, timestamp: NOW, event: { kind: "turn_started" } },
      { epoch: 1, seq: 2, timestamp: NOW, event: { kind: "assistant_message", text: "hi" } },
      { epoch: 1, seq: 3, timestamp: NOW, event: { kind: "turn_completed" } },
    ];
    const client: AgentClient = {
      provider: "pi",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      createSession: () => {
        throw new Error("not used");
      },
      resumeSession: () => {
        throw new Error("not used");
      },
      listModels: () => Promise.resolve([]),
      isAvailable: () => true,
      hydrateTimeline: () => rows,
    };

    const record: AgentRecord = {
      id: "agent-1",
      provider: "pi",
      cwd: "/work",
      createdAt: NOW,
      updatedAt: NOW,
      labels: {},
      lastStatus: "idle",
      timeline: [],
      persistence: { provider: "pi", sessionId: "s1", nativeHandle: "/fake/session.jsonl" },
    };
    const manager = await makeRestartedAgentManager(record);

    const registry = new HandlerRegistry();
    registerTimelineHandler(registry, { manager, resolveClient: () => client });

    const handler = registry.get("fetch_agent_timeline_request")!;
    const resp = (await handler(fakeCtx("agent-1"))) as Record<string, unknown>;

    expect(resp.type).toBe("fetch_agent_timeline_response");
    expect(Array.isArray(resp.items)).toBe(true);
    expect((resp.items as unknown[]).length).toBeGreaterThan(0);
    expect(resp.hasNewer).toBe(false);

    // A second fetch must NOT re-invoke hydrateTimeline — the rows are seeded once into the
    // in-memory store, matching a live agent's behavior for all subsequent pages.
    let hydrateCalls = 0;
    const countingClient: AgentClient = {
      ...client,
      hydrateTimeline: () => {
        hydrateCalls++;
        return rows;
      },
    };
    const registry2 = new HandlerRegistry();
    registerTimelineHandler(registry2, { manager, resolveClient: () => countingClient });
    const handler2 = registry2.get("fetch_agent_timeline_request")!;
    await handler2(fakeCtx("agent-1"));
    await handler2(fakeCtx("agent-1"));
    // Already seeded by the first registry's handler call above (module-level timeline map), so
    // this provider is never even consulted.
    expect(hydrateCalls).toBe(0);
  });

  it("returns an empty page when the record has no persistence handle to rehydrate from", async () => {
    const record: AgentRecord = {
      id: "agent-2",
      provider: "pi",
      cwd: "/work",
      createdAt: NOW,
      updatedAt: NOW,
      labels: {},
      lastStatus: "idle",
      timeline: [],
    };
    const manager = await makeRestartedAgentManager(record);
    const registry = new HandlerRegistry();
    registerTimelineHandler(registry, {
      manager,
      resolveClient: () => {
        throw new Error("should not resolve a client with no handle");
      },
    });

    const handler = registry.get("fetch_agent_timeline_request")!;
    const resp = (await handler(fakeCtx("agent-2"))) as Record<string, unknown>;
    expect(resp.items).toEqual([]);
    expect(resp.hasNewer).toBe(false);
  });
});
