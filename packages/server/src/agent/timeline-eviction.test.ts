import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import { HandlerRegistry } from "../ws/router.js";
import { AgentManager, PARENT_AGENT_ID_LABEL } from "./agent-manager.js";
import { AgentService, timelineFor } from "./agent-service.js";
import { MOCK_CAPABILITIES, MockAgentClient } from "./providers/mock/mock-provider.js";
import type {
  AgentClient,
  AgentSession,
  PersistenceHandle,
  Unsubscribe,
} from "./provider-contract.js";
import { registerTimelineHandler } from "./timeline-rpc.js";
import type { TimelineRow } from "./timeline-store.js";

/**
 * sprint-150/task-004: archiving or deleting an agent drops its in-memory history (the cascade to
 * children included); a fetch for an archived agent rebuilds it from the provider's file; and a
 * turn that ends because of the archive or delete does not bring the store back.
 */

const NOW = "2026-11-25T12:00:00.000Z";
const PARENT_ID = "parent-agent";
const CHILD_ID = "child-agent";

const HISTORY: TimelineRow[] = [
  {
    epoch: 1,
    seq: 0,
    seqEnd: 0,
    timestamp: NOW,
    event: { kind: "user_message", messageId: "m1", text: "old question" },
  },
  { epoch: 1, seq: 1, seqEnd: 1, timestamp: NOW, event: { kind: "turn_completed" } },
];

/** A mock whose "session file" replays `HISTORY`, as `PiAgentClient.hydrateTimeline` would. */
class HistoryClient extends MockAgentClient {
  hydrateTimeline(_handle: PersistenceHandle): TimelineRow[] {
    return HISTORY;
  }
}

/**
 * A session whose turn ends only when it is closed: `interrupt` emits the cancel, and `close` lets
 * the run finish with one more event, the way a dying provider process can.
 */
class DyingSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly closed = Promise.withResolvers<void>();

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "t1" });
  }
  async run(): Promise<void> {
    this.emit({ kind: "turn_started" });
    await this.closed.promise;
    this.emit({ kind: "assistant_message", text: "late" });
  }
  interrupt(): Promise<void> {
    this.emit({ kind: "turn_canceled" });
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed.resolve();
    return Promise.resolve();
  }
  getRuntimeInfo() {
    return { provider: "mock" };
  }
  describePersistence() {
    return null;
  }
  private emit(event: AgentStreamEvent): void {
    for (const cb of this.subscribers) cb(event);
  }
}

function record(id: string, overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id,
    provider: "mock",
    cwd: "/work",
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "idle",
    persistence: { provider: "mock", sessionId: id, nativeHandle: `/fake/${id}.jsonl` },
    ...overrides,
  };
}

async function setup(records: AgentRecord[]): Promise<{
  manager: AgentManager;
  service: AgentService;
  client: AgentClient;
  fetch: (agentId: string) => Promise<{ items: unknown[] }>;
}> {
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve(records),
    deleteAgent: () => Promise.resolve(true),
    now: () => NOW,
  });
  await manager.recover(); // records only: no session, no in-memory timeline
  const client = new HistoryClient({ turnDelayMs: 0 });
  const service = new AgentService({
    manager,
    resolveClient: () => client,
    broadcast: () => {},
    now: () => NOW,
  });
  const registry = new HandlerRegistry();
  registerTimelineHandler(registry, { manager, resolveClient: () => client });
  const handler = registry.get("fetch_agent_timeline_request")!;
  const fetch = async (agentId: string): Promise<{ items: unknown[] }> =>
    (await handler({
      message: { agentId, direction: "after" },
      requestId: "r",
      session: null,
    })) as { items: unknown[] };
  return { manager, service, client, fetch };
}

describe("archive", () => {
  it("drops the agent's store, and a fetch for the archived agent rebuilds its history", async () => {
    const { manager, fetch } = await setup([record(PARENT_ID)]);
    const before = await fetch(PARENT_ID);
    expect(before.items.length).toBeGreaterThan(0);
    expect(manager.timelines.size).toBe(1);

    await manager.archiveAgent(PARENT_ID);

    expect(manager.timelines.size).toBe(0);
    const after = await fetch(PARENT_ID);
    expect(after.items).toEqual(before.items);
  });

  it("drops the stores of the children it cascades to", async () => {
    const { manager, fetch } = await setup([
      record(PARENT_ID),
      record(CHILD_ID, { labels: { [PARENT_AGENT_ID_LABEL]: PARENT_ID } }),
    ]);
    await fetch(PARENT_ID);
    await fetch(CHILD_ID);
    expect(manager.timelines.size).toBe(2);

    await manager.archiveAgent(PARENT_ID);

    expect(manager.timelines.size).toBe(0);
  });
});

describe("delete", () => {
  it("drops the stores of the agent and of the children it cascades to", async () => {
    const { manager, fetch } = await setup([
      record(PARENT_ID),
      record(CHILD_ID, { labels: { [PARENT_AGENT_ID_LABEL]: PARENT_ID } }),
    ]);
    await fetch(PARENT_ID);
    await fetch(CHILD_ID);
    expect(manager.timelines.size).toBe(2);

    await manager.deleteAgent(PARENT_ID);

    expect(manager.timelines.size).toBe(0);
    expect((await fetch(PARENT_ID)).items).toEqual([]);
  });

  it("mid-turn does not bring the store back when the dying turn ends", async () => {
    const { manager, service } = await setup([record(PARENT_ID)]);
    manager.attachSession(PARENT_ID, new DyingSession());

    const send = service.handleSendPrompt({ agentId: PARENT_ID, prompt: "go" }, () => []);
    await expect.poll(() => manager.timelines.size).toBe(1);

    await manager.deleteAgent(PARENT_ID);
    await send;

    expect(manager.timelines.size).toBe(0);
  });

  it("mid-turn archive leaves no store either", async () => {
    const { manager, service } = await setup([record(PARENT_ID)]);
    manager.attachSession(PARENT_ID, new DyingSession());

    const send = service.handleSendPrompt({ agentId: PARENT_ID, prompt: "go" }, () => []);
    await expect.poll(() => manager.timelines.size).toBe(1);

    await manager.archiveAgent(PARENT_ID);
    await send;

    expect(manager.timelines.size).toBe(0);
  });
});

describe("timelineFor", () => {
  it("refuses an agent that is archived or gone, so no store is created for it", async () => {
    const { manager, client } = await setup([record(PARENT_ID), record(CHILD_ID)]);
    await manager.archiveAgent(PARENT_ID);
    await manager.deleteAgent(CHILD_ID);
    const deps = { manager, resolveClient: () => client };

    expect(() => timelineFor(deps, PARENT_ID)).toThrow("gone or archived");
    expect(() => timelineFor(deps, CHILD_ID)).toThrow("gone or archived");
    expect(manager.timelines.size).toBe(0);
  });
});
