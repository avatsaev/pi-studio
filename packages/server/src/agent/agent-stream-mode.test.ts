import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { Session } from "../ws/session.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService, getTimeline } from "./agent-service.js";
import { MockAgentClient, type MockAgentSession } from "./providers/mock/mock-provider.js";
import { SessionOperationsService } from "./session-operations.js";

/**
 * sprint-098/task-001: a session whose `hello.agentStreams` is `"none"` receives no `agent_stream`
 * frame at any send site, whoever started the turn, while every other broadcast still reaches it.
 * The timeline is appended to regardless of who is listening.
 */

const NOW = "2026-06-11T12:00:00.000Z";

type FakeSession = Session & { received: Array<Record<string, unknown>> };

function fakeSession(id: string, agentStreams?: "all" | "none"): FakeSession {
  return { id, agentStreams, received: [] } as unknown as FakeSession;
}

function setup(): {
  quiet: FakeSession;
  loud: FakeSession;
  sessions: () => Iterable<Session>;
  service: AgentService;
  ops: SessionOperationsService;
  manager: AgentManager;
} {
  const quiet = fakeSession("quiet", "none");
  const loud = fakeSession("loud");
  const broadcast = (sessions: Iterable<Session>, msg: unknown): void => {
    const message = (msg as { message?: Record<string, unknown> }).message ?? {};
    const frame = message.type ? message : (msg as Record<string, unknown>);
    for (const session of sessions) (session as FakeSession).received.push(frame);
  };
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
    broadcast,
    now: () => NOW,
  });
  const ops = new SessionOperationsService({
    manager,
    resolveClient: () => client,
    service,
    broadcast,
    now: () => NOW,
  });
  return { quiet, loud, sessions: () => [quiet, loud], service, ops, manager };
}

const streamKinds = (s: FakeSession): string[] =>
  s.received
    .filter((m) => m.type === "agent_stream")
    .map((m) => (m.event as AgentStreamEvent).kind);

const updateStatuses = (s: FakeSession): unknown[] =>
  s.received.filter((m) => m.type === "agent_update").map((m) => m.status);

async function createAgent(
  service: AgentService,
  sessions: () => Iterable<Session>,
): Promise<string> {
  const result = (await service.handleCreate(
    { requestId: "r", config: { provider: "mock", cwd: "/w" }, initialPrompt: "hi" },
    sessions,
  )) as Record<string, unknown>;
  return (result.payload as Record<string, unknown>).agentId as string;
}

describe("agent stream mode", () => {
  it("sends a quiet session no agent_stream frame during a turn, and a normal session all of them", async () => {
    const { quiet, loud, sessions, service, manager } = setup();
    const agentId = await createAgent(service, sessions);
    const session = manager.get(agentId)!.session as MockAgentSession;

    await service.runTurn(agentId, session, "#tool shell", sessions);

    expect(streamKinds(quiet)).toEqual([]);
    // Ephemeral partials, sequenced events and the user_message all reached the other session.
    expect(streamKinds(loud)).toEqual(expect.arrayContaining(["user_message", "tool_call"]));
    expect(
      loud.received.some(
        (m) =>
          m.type === "agent_stream" &&
          (m.event as AgentStreamEvent).kind === "tool_call" &&
          (m.event as { partial?: boolean }).partial === true,
      ),
    ).toBe(true);
    // The turn's status broadcasts are not streams: the quiet session still sees the turn run and end.
    expect(updateStatuses(quiet)).toEqual(expect.arrayContaining(["running", "idle"]));
    expect(updateStatuses(quiet)).toEqual(updateStatuses(loud));
  });

  it("still appends to the timeline what the quiet session did not receive", async () => {
    const { quiet, sessions, service, manager } = setup();
    const agentId = await createAgent(service, sessions);
    const session = manager.get(agentId)!.session as MockAgentSession;

    await service.runTurn(agentId, session, "hello", sessions);

    expect(streamKinds(quiet)).toEqual([]);
    const kinds = getTimeline(agentId)!
      .allRows()
      .map((r) => r.event.kind);
    expect(kinds).toContain("user_message");
    expect(kinds.length).toBeGreaterThan(1);
  });

  it("applies to the optimistic user_message and queue_update of steer and follow-up", async () => {
    const { quiet, loud, sessions, service, ops, manager } = setup();
    const agentId = await createAgent(service, sessions);
    const session = manager.get(agentId)!.session as MockAgentSession;
    await service.runTurn(agentId, session, "first", sessions);
    quiet.received.length = 0;
    loud.received.length = 0;

    await ops.handleSteer({ agentId, message: "go left" }, sessions, "steer");

    expect(streamKinds(quiet)).toEqual([]);
    expect(streamKinds(loud)).toContain("user_message");
  });

  it("treats a session without a mode as a normal one", async () => {
    const { loud, sessions, service, manager } = setup();
    expect(loud.agentStreams).toBeUndefined();
    const agentId = await createAgent(service, sessions);
    await service.runTurn(agentId, manager.get(agentId)!.session!, "hi", sessions);
    expect(streamKinds(loud).length).toBeGreaterThan(0);
  });
});
