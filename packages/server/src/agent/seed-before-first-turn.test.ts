import { describe, expect, it } from "vitest";

import { agentCalls } from "../test-support/answer-then-run.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import type { PersistenceHandle } from "./provider-contract.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { registerTimelineHandler } from "./timeline-rpc.js";
import type { TimelineRow } from "./timeline-store.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";
import { HandlerRegistry } from "../ws/router.js";

type StreamEvent = { kind: string; text?: string };

/**
 * sprint-150/task-001: after a daemon restart the first thing that happens to a recovered agent
 * may be a send, not a timeline fetch. `runTurn` used to create an empty in-memory store, after
 * which seeding (a no-op once a store exists) could never bring the Pi session file's history in.
 */

const NOW = "2026-11-25T12:00:00.000Z";
const AGENT_ID = "recovered-agent";

const HISTORY: TimelineRow[] = [
  {
    epoch: 1,
    seq: 0,
    seqEnd: 0,
    timestamp: NOW,
    event: { kind: "user_message", text: "old question" },
  },
  { epoch: 1, seq: 1, seqEnd: 1, timestamp: NOW, event: { kind: "turn_started" } },
  {
    epoch: 1,
    seq: 2,
    seqEnd: 2,
    timestamp: NOW,
    event: { kind: "assistant_message", text: "old answer" },
  },
  { epoch: 1, seq: 3, seqEnd: 3, timestamp: NOW, event: { kind: "turn_completed" } },
];

/** A mock whose "session file" replays `HISTORY`, as `PiAgentClient.hydrateTimeline` would. */
class HistoryClient extends MockAgentClient {
  hydrateCalls = 0;

  hydrateTimeline(_handle: PersistenceHandle): TimelineRow[] {
    this.hydrateCalls++;
    return HISTORY;
  }
}

async function recoveredAgent(): Promise<{
  service: AgentService;
  registry: HandlerRegistry;
  client: HistoryClient;
}> {
  const record: AgentRecord = {
    id: AGENT_ID,
    provider: "mock",
    cwd: "/work",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "idle",
    persistence: { provider: "mock", sessionId: "s1", nativeHandle: "/fake/session.jsonl" },
  };
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([record]),
    now: () => NOW,
  });
  await manager.recover(); // record only: no session, no in-memory timeline
  const client = new HistoryClient({ turnDelayMs: 0 });
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: () => {},
    now: () => NOW,
  });
  const registry = new HandlerRegistry();
  registerTimelineHandler(registry, { manager, resolveClient: () => client });
  return { service, registry, client };
}

describe("a send before any timeline fetch on a recovered agent", () => {
  it("keeps the earlier history ahead of the new turn", async () => {
    const { service, registry, client } = await recoveredAgent();

    await agentCalls(service).sendSettled({ agentId: AGENT_ID, prompt: "new question" });

    const fetch = registry.get("fetch_agent_timeline_request")!;
    const response = (await fetch({
      message: { agentId: AGENT_ID, direction: "after" },
      requestId: "r1",
      session: null,
    })) as { items: { event?: StreamEvent; events?: StreamEvent[] }[] };

    const texts = response.items
      .flatMap((item) => item.events ?? (item.event ? [item.event] : []))
      .filter((e) => e.kind === "user_message" || e.kind === "assistant_message")
      .map((e) => e.text);
    expect(texts.slice(0, 2)).toEqual(["old question", "old answer"]);
    expect(texts.slice(2)).toEqual(["new question", "echo: new question"]);
    expect(client.hydrateCalls).toBe(1);
  });
});
