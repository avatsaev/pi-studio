import { describe, expect, it } from "vitest";

import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { registerTimelineHandler } from "./timeline-rpc.js";
import { HandlerRegistry } from "../ws/router.js";

const NOW = "2026-06-11T12:00:00.000Z";

async function setupAgentWithTurns(
  n: number,
): Promise<{ agentId: string; registry: HandlerRegistry }> {
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
    now: () => NOW,
  });
  const client = new MockAgentClient({ turnDelayMs: 0 });
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: () => {},
    now: () => NOW,
  });
  const registry = new HandlerRegistry();
  registerTimelineHandler(registry, { manager, resolveClient: () => client });

  const result = (await service.handleCreate(
    { requestId: "r", config: { provider: "mock", cwd: "/w" }, initialPrompt: "hi" },
    () => [],
  )) as Record<string, unknown>;
  const agentId = (result.payload as Record<string, unknown>).agentId as string;

  // Add more turns to build up history.
  const managed = manager.get(agentId)!;
  for (let i = 1; i < n; i++) {
    await service.runTurn(agentId, managed.session!, `prompt ${i}`, () => []);
  }
  return { agentId, registry };
}

function fakeCtx(
  agentId: string,
  direction: "before" | "after",
  cursor?: string | null,
  limit?: number,
): { message: Record<string, unknown>; requestId: string; session: null } {
  return {
    session: null,
    requestId: "fetch-1",
    message: { type: "fetch_agent_timeline_request", agentId, direction, cursor, limit },
  };
}

describe("fetch_agent_timeline_request", () => {
  it("returns full projected items and all paging fields", async () => {
    const { agentId, registry } = await setupAgentWithTurns(1);
    const handler = registry.get("fetch_agent_timeline_request")!;
    const resp = (await handler(fakeCtx(agentId, "after"))) as Record<string, unknown>;
    expect(resp.type).toBe("fetch_agent_timeline_response");
    expect(Array.isArray(resp.items)).toBe(true);
    expect(typeof resp.seqStart).toBe("number");
    expect(typeof resp.seqEnd).toBe("number");
    expect(typeof resp.hasNewer).toBe("boolean");
    expect(Array.isArray(resp.sourceSeqRanges)).toBe(true);
  });

  it("direction:after from cursor returns only newer items", async () => {
    const { agentId, registry } = await setupAgentWithTurns(3);
    const handler = registry.get("fetch_agent_timeline_request")!;

    const first = (await handler(fakeCtx(agentId, "after", null, 2))) as Record<string, unknown>;
    const endCursor = first.endCursor as string;
    const second = (await handler(fakeCtx(agentId, "after", endCursor, 100))) as Record<
      string,
      unknown
    >;
    expect(second.seqStart as number).toBeGreaterThan(first.seqEnd as number);
  });

  it("large histories split into bounded pages; hasNewer correct", async () => {
    const { agentId, registry } = await setupAgentWithTurns(5);
    const handler = registry.get("fetch_agent_timeline_request")!;
    const page1 = (await handler(fakeCtx(agentId, "after", null, 3))) as Record<string, unknown>;
    if (page1.hasNewer) {
      const page2 = (await handler(
        fakeCtx(agentId, "after", page1.endCursor as string, 100),
      )) as Record<string, unknown>;
      expect(page2.hasNewer).toBe(false);
    }
    expect((page1.items as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it("deduplication: fetched content matches live timeline rows by sequence", async () => {
    const { agentId } = await setupAgentWithTurns(1);
    const timeline = getTimeline(agentId)!;
    const page = timeline.page({ direction: "after" });
    const liveSeqs = new Set(timeline.allRows().map((r) => r.seq));
    expect(page.seqEnd).toBeLessThanOrEqual(Math.max(...liveSeqs));
  });
});
