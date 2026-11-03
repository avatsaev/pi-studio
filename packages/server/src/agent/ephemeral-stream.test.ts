import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import { HandlerRegistry } from "../ws/router.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { MockAgentClient, type MockAgentSession } from "./providers/mock/mock-provider.js";
import { registerTimelineHandler } from "./timeline-rpc.js";

/**
 * sprint-058/task-004: partial `tool_call` and `queue_update` events are broadcast live with a
 * daemon-owned `timestamp` but no `seq`, and are never appended to the timeline.
 */

const NOW = "2026-06-11T12:00:00.000Z";

interface StreamFrame {
  agentId: string;
  seq?: number;
  timestamp: string;
  event: AgentStreamEvent;
}

async function setup(): Promise<{
  agentId: string;
  service: AgentService;
  session: MockAgentSession;
  frames: StreamFrame[];
  registry: HandlerRegistry;
}> {
  const frames: StreamFrame[] = [];
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
    broadcast: (_sessions, msg) => {
      const message = (msg as { message?: { type?: string } }).message;
      if (message?.type === "agent_stream") frames.push(message as unknown as StreamFrame);
    },
    now: () => NOW,
  });
  const registry = new HandlerRegistry();
  registerTimelineHandler(registry, { manager, resolveClient: () => client });

  const result = (await service.handleCreate(
    { requestId: "r", config: { provider: "mock", cwd: "/w" }, initialPrompt: "hi" },
    () => [],
  )) as Record<string, unknown>;
  const agentId = (result.payload as Record<string, unknown>).agentId as string;
  const session = manager.get(agentId)!.session as MockAgentSession;
  return { agentId, service, session, frames, registry };
}

function isPartial(event: AgentStreamEvent): boolean {
  return event.kind === "tool_call" && event.partial === true;
}

describe("ephemeral partial tool_call broadcast", () => {
  it("broadcasts partials live without seq, persists only start + end rows", async () => {
    const { agentId, service, session, frames } = await setup();
    await service.runTurn(agentId, session, "#tool shell", () => []);

    const partialFrames = frames.filter((f) => isPartial(f.event));
    expect(partialFrames).toHaveLength(3);
    for (const frame of partialFrames) {
      expect(frame.seq).toBeUndefined();
      expect(typeof frame.timestamp).toBe("string");
      expect(Number.isNaN(Date.parse(frame.timestamp))).toBe(false);
    }

    const toolRows = getTimeline(agentId)!
      .allRows()
      .filter((r) => r.event.kind === "tool_call");
    expect(
      toolRows.map((r) => (r.event.kind === "tool_call" ? r.event.status : undefined)),
    ).toEqual(["running", "completed"]);
    expect(toolRows.some((r) => isPartial(r.event))).toBe(false);

    // Persisted frames still carry a seq.
    const persistedTool = frames.filter((f) => f.event.kind === "tool_call" && !isPartial(f.event));
    expect(persistedTool).toHaveLength(2);
    for (const frame of persistedTool) expect(typeof frame.seq).toBe("number");
  });

  it("fetch_agent_timeline_request returns no partials and one projected tool_call item", async () => {
    const { agentId, service, session, registry } = await setup();
    await service.runTurn(agentId, session, "#tool shell", () => []);

    const handler = registry.get("fetch_agent_timeline_request")!;
    const resp = (await handler({
      session: null,
      requestId: "fetch-1",
      message: { type: "fetch_agent_timeline_request", agentId, direction: "after" },
    })) as { items: { kind: string; events?: AgentStreamEvent[] }[] };

    const toolItems = resp.items.filter((i) => i.kind === "tool_call");
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]!.events).toHaveLength(2);
    expect(toolItems[0]!.events!.some((e) => isPartial(e))).toBe(false);
  });
});

describe("ephemeral queue_update broadcast", () => {
  it("is broadcast live without seq and never appended to the timeline", async () => {
    const { agentId, service, session, frames } = await setup();
    // Steer from inside the turn, once it has started and `runTurn` is subscribed.
    const unsub = session.subscribe((event) => {
      if (event.kind === "turn_started") {
        unsub();
        void session.steer("focus");
      }
    });
    await service.runTurn(agentId, session, "next", () => []);

    const queueFrames = frames.filter((f) => f.event.kind === "queue_update");
    expect(queueFrames).toHaveLength(1);
    expect(queueFrames[0]!.seq).toBeUndefined();
    expect(typeof queueFrames[0]!.timestamp).toBe("string");
    expect(queueFrames[0]!.event).toEqual({
      kind: "queue_update",
      steering: ["focus"],
      followUp: [],
    });
    expect(
      getTimeline(agentId)!
        .allRows()
        .some((r) => r.event.kind === "queue_update"),
    ).toBe(false);
  });
});
