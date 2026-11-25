import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import type { AgentSession, Unsubscribe } from "./provider-contract.js";
import { MOCK_CAPABILITIES, MockAgentClient } from "./providers/mock/mock-provider.js";
import { SessionOperationsService } from "./session-operations.js";

/**
 * `create_agent_request` and `send_agent_prompt` answer as soon as the prompt is accepted
 * (sprint-151/task-003), through the real router: the answer is the request's first frame, the
 * turn runs on after it and reports through `agent_update` and `agent_stream`, and nothing it
 * does can become an unhandled rejection. `wire` is what the one connected client received, in
 * order: `answer:<type>` for an RPC's answer, `error:<message>` for an `rpc_error`,
 * `update:<status>` for an `agent_update` and `stream:<kind>` for an `agent_stream` row.
 */

const NOW = "2026-11-25T12:00:00.000Z";

/** A provider session whose turn runs until the test opens `turnGate`. */
class GateSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;
  readonly turnGate = Promise.withResolvers<void>();
  runs = 0;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "t1" });
  }
  async run(): Promise<void> {
    this.runs++;
    this.emit({ kind: "turn_started" });
    await this.turnGate.promise;
    this.emit({ kind: "assistant_message", text: "reply" });
    this.emit({ kind: "turn_completed" });
  }
  interrupt(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
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

/** A client whose spawn and resume (`start`) the test can delay or fail. */
class GateClient extends MockAgentClient {
  readonly session = new GateSession();
  starts = 0;
  start: () => Promise<AgentSession> = () => Promise.resolve(this.session);

  override createSession(): Promise<AgentSession> {
    this.starts++;
    return this.start();
  }
  override resumeSession(): Promise<AgentSession> {
    this.starts++;
    return this.start();
  }
}

/** The connected client: what the router and the service send it is recorded in `sent`. */
class Connection {
  readonly sent: unknown[] = [];
  readonly id = "conn-1";
  readonly clientId = "client-1";
  readonly agentStreams = undefined;

  send(frame: unknown): void {
    this.sent.push(frame);
  }
  supports(): boolean {
    return false;
  }
}

function describeFrame(frame: unknown): string {
  if (typeof frame !== "object" || frame === null || !("message" in frame)) return "other";
  const { message } = frame;
  if (typeof message !== "object" || message === null || !("type" in message)) return "other";
  if (message.type === "agent_update" && "status" in message) {
    return `update:${String(message.status)}`;
  }
  if (message.type === "agent_stream" && "event" in message) {
    const { event } = message;
    return typeof event === "object" && event !== null && "kind" in event
      ? `stream:${String(event.kind)}`
      : "stream";
  }
  if (message.type === "rpc_error" && "message" in message) {
    return `error:${String(message.message)}`;
  }
  return `answer:${String(message.type)}`;
}

function count(lines: string[], line: string): number {
  return lines.filter((candidate) => candidate === line).length;
}

function nextMacrotask(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

/** As the daemon's `broadcast`: a message not already in the `session` envelope is wrapped. */
function broadcast(sessions: Iterable<Session>, message: unknown): void {
  const wrapped =
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "session";
  for (const recipient of sessions) {
    recipient.send(wrapped ? message : { type: "session", message });
  }
}

function harness() {
  const client = new GateClient();
  const connection = new Connection();
  const session = connection as unknown as Session;
  const open = new Set<Session>([session]);
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
    deleteAgent: () => Promise.resolve(true),
    now: () => NOW,
  });
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
  const registry = new HandlerRegistry();
  service.registerHandlers(registry, () => open);
  ops.registerHandlers(registry, () => open);

  /** One request through the router; resolves once the router has handled it and sent its answer. */
  const request = (message: Record<string, unknown>): Promise<void> =>
    routeTextFrame(
      session,
      JSON.stringify({ type: "session", message: { requestId: randomUUID(), ...message } }),
      registry,
    );
  const wire = (): string[] => connection.sent.map(describeFrame);
  const onlyAgentId = (): string => {
    const [only, ...rest] = manager.listAll();
    if (!only || rest.length > 0) throw new Error("expected exactly one agent");
    return only.record.id;
  };
  const rowKinds = (agentId: string): string[] =>
    manager.timelines
      .get(agentId)
      ?.allRows()
      .map((row) => row.event.kind) ?? [];
  const status = (agentId: string) => manager.get(agentId)?.record.lastStatus;
  const create = (extra: Record<string, unknown> = {}): Promise<void> =>
    request({ type: "create_agent_request", config: { provider: "mock", cwd: "/work" }, ...extra });
  const send = (agentId: string, prompt: string): Promise<void> =>
    request({ type: "send_agent_prompt", agentId, prompt });
  const interrupt = (agentId: string): Promise<void> =>
    request({ type: "interrupt_agent", agentId });
  /** A draft with no process, as the workbench creates one before its first send. */
  const createDraft = async (): Promise<string> => {
    await create();
    connection.sent.length = 0;
    return onlyAgentId();
  };
  return {
    client,
    connection,
    session,
    open,
    manager,
    service,
    wire,
    onlyAgentId,
    rowKinds,
    status,
    create,
    send,
    interrupt,
    createDraft,
  };
}

const unhandled: unknown[] = [];
const recordUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", recordUnhandled);
});

afterEach(async () => {
  await nextMacrotask();
  process.off("unhandledRejection", recordUnhandled);
  expect(unhandled).toEqual([]);
});

describe("create with a prompt", () => {
  it("answers before the turn's first frame, while Pi is still starting", async () => {
    const { client, service, wire, onlyAgentId, status, create } = harness();
    const startGate = Promise.withResolvers<AgentSession>();
    client.start = () => startGate.promise;

    await create({ initialPrompt: "go" });

    const agentId = onlyAgentId();
    expect(wire()).toEqual([
      "update:initializing",
      "answer:create_agent_response",
      "update:running",
      "stream:user_message",
    ]);
    expect(status(agentId)).toBe("running");
    expect(service.hasTurn(agentId)).toBe(true);

    client.session.turnGate.resolve();
    startGate.resolve(client.session);
    await service.turnSettled(agentId);

    expect(wire().slice(4)).toEqual([
      "stream:turn_started",
      "stream:assistant_message",
      "stream:turn_completed",
      "update:idle",
    ]);
    expect(status(agentId)).toBe("idle");
    expect(service.hasTurn(agentId)).toBe(false);
  });

  it("answers while the turn is still running", async () => {
    const { client, service, wire, onlyAgentId, status, rowKinds, create } = harness();

    await create({ initialPrompt: "go" });
    await vi.waitFor(() => expect(client.session.runs).toBe(1));

    const agentId = onlyAgentId();
    expect(wire()).toEqual([
      "update:initializing",
      "answer:create_agent_response",
      "update:running",
      "stream:user_message",
      "stream:turn_started",
    ]);
    expect(status(agentId)).toBe("running");

    client.session.turnGate.resolve();
    await service.turnSettled(agentId);
    expect(rowKinds(agentId)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
  });

  it("archives the agent after the turn when autoArchive is set", async () => {
    const { client, service, manager, onlyAgentId, create } = harness();
    client.session.turnGate.resolve();

    await create({ initialPrompt: "go", autoArchive: true });
    await service.turnSettled(onlyAgentId());

    expect(manager.get(onlyAgentId())?.record.archivedAt).toBeDefined();
  });

  it("answers a draft created without a prompt as before: idle, no process, no turn", async () => {
    const { client, service, wire, onlyAgentId, status, create } = harness();

    await create();

    const agentId = onlyAgentId();
    expect(wire()).toEqual(["update:initializing", "update:idle", "answer:create_agent_response"]);
    expect(status(agentId)).toBe("idle");
    expect(client.starts).toBe(0);
    expect(service.hasTurn(agentId)).toBe(false);
  });
});

describe("send", () => {
  it("answers before the turn's first frame, while the turn is still running", async () => {
    const { client, service, wire, status, rowKinds, send, createDraft } = harness();
    const agentId = await createDraft();

    await send(agentId, "go");
    await vi.waitFor(() => expect(client.session.runs).toBe(1));

    expect(wire()).toEqual([
      "answer:agent_prompt_response",
      "update:running",
      "stream:user_message",
      "stream:turn_started",
    ]);
    expect(status(agentId)).toBe("running");

    client.session.turnGate.resolve();
    await service.turnSettled(agentId);
    expect(wire().slice(4)).toEqual([
      "stream:assistant_message",
      "stream:turn_completed",
      "update:idle",
    ]);
    expect(rowKinds(agentId)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
  });

  it("refuses a second send while the first runs with busy, and adds no rows", async () => {
    const { client, service, wire, rowKinds, send, createDraft } = harness();
    const agentId = await createDraft();
    await send(agentId, "one");
    await vi.waitFor(() => expect(client.session.runs).toBe(1));
    const framesBefore = wire().length;
    const rowsBefore = rowKinds(agentId);

    await send(agentId, "two");

    expect(wire().slice(framesBefore)).toEqual([`error:busy: agent ${agentId} is running`]);
    expect(rowKinds(agentId)).toEqual(rowsBefore);

    client.session.turnGate.resolve();
    await service.turnSettled(agentId);
    expect(client.session.runs).toBe(1);
  });

  it("completes the turn and keeps it on the timeline when the socket closes right after the answer", async () => {
    const { client, connection, open, session, service, status, rowKinds, send, createDraft } =
      harness();
    const agentId = await createDraft();

    await send(agentId, "go");
    open.delete(session);
    const framesAtClose = connection.sent.length;
    client.session.turnGate.resolve();
    await service.turnSettled(agentId);

    expect(rowKinds(agentId)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
    expect(status(agentId)).toBe("idle");
    expect(connection.sent).toHaveLength(framesAtClose);
  });
});

describe("Pi cannot start after the prompt was accepted", () => {
  it("create: answers with success, then records turn_failed with the reason and settles error", async () => {
    const { client, service, wire, onlyAgentId, status, rowKinds, create } = harness();
    client.start = () => Promise.reject(new Error("pi not found on PATH"));

    await create({ initialPrompt: "go" });
    const agentId = onlyAgentId();
    await service.turnSettled(agentId);

    expect(wire()).toEqual([
      "update:initializing",
      "answer:create_agent_response",
      "update:running",
      "stream:user_message",
      "stream:turn_failed",
      "update:error",
    ]);
    expect(rowKinds(agentId)).toEqual(["user_message", "turn_failed"]);
    expect(status(agentId)).toBe("error");
  });

  it("send: answers with success, then records turn_failed with the reason and settles error", async () => {
    const { client, service, wire, status, rowKinds, send, createDraft } = harness();
    client.start = () => Promise.reject(new Error("pi not found on PATH"));
    const agentId = await createDraft();

    await send(agentId, "go");
    await service.turnSettled(agentId);

    expect(wire()).toEqual([
      "answer:agent_prompt_response",
      "update:running",
      "stream:user_message",
      "stream:turn_failed",
      "update:error",
    ]);
    expect(rowKinds(agentId)).toEqual(["user_message", "turn_failed"]);
    expect(status(agentId)).toBe("error");
  });
});

describe("an interrupt while Pi is still starting", () => {
  it("create: ends the turn once, as turn_canceled then idle, and the agent takes the next send", async () => {
    const {
      client,
      manager,
      service,
      wire,
      onlyAgentId,
      status,
      rowKinds,
      send,
      create,
      interrupt,
    } = harness();
    const startGate = Promise.withResolvers<AgentSession>();
    client.start = () => startGate.promise;
    await create({ initialPrompt: "go" });
    const agentId = onlyAgentId();

    await interrupt(agentId);
    await service.turnSettled(agentId);

    const frames = wire();
    expect(frames).toContain("answer:interrupt_response");
    expect(count(frames, "stream:turn_canceled")).toBe(1);
    expect(count(frames, "update:idle")).toBe(1);
    expect(count(frames, "update:error")).toBe(0);
    expect(rowKinds(agentId)).toEqual(["user_message", "turn_canceled"]);
    expect(status(agentId)).toBe("idle");

    // The start the turn left behind finishes and attaches its session; the next send uses it.
    startGate.resolve(client.session);
    await vi.waitFor(() => expect(manager.get(agentId)?.session).toBe(client.session));
    client.session.turnGate.resolve();
    const framesBefore = frames.length;
    await send(agentId, "again");
    await service.turnSettled(agentId);

    expect(wire().slice(framesBefore)).toEqual([
      "answer:agent_prompt_response",
      "update:running",
      "stream:user_message",
      "stream:turn_started",
      "stream:assistant_message",
      "stream:turn_completed",
      "update:idle",
    ]);
    expect(status(agentId)).toBe("idle");
    expect(client.starts).toBe(1);
  });

  it("send: a send right after the interrupt shares the start the first one began", async () => {
    const { client, service, wire, status, rowKinds, send, createDraft, interrupt } = harness();
    const agentId = await createDraft();
    const startGate = Promise.withResolvers<AgentSession>();
    client.start = () => startGate.promise;
    await send(agentId, "first");
    await vi.waitFor(() => expect(client.starts).toBe(1));

    await interrupt(agentId);
    await vi.waitFor(() => expect(service.hasTurn(agentId)).toBe(false));
    expect(status(agentId)).toBe("idle");
    expect(count(wire(), "stream:turn_canceled")).toBe(1);
    expect(count(wire(), "update:idle")).toBe(1);

    await send(agentId, "second");
    client.session.turnGate.resolve();
    startGate.resolve(client.session);
    await service.turnSettled(agentId);

    expect(client.starts).toBe(1);
    expect(client.session.runs).toBe(1);
    expect(rowKinds(agentId)).toEqual([
      "user_message",
      "turn_canceled",
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
    expect(status(agentId)).toBe("idle");
  });

  it("is not a cancel once Pi has the prompt: the provider ends the turn", async () => {
    const { client, service, wire, rowKinds, send, createDraft, interrupt } = harness();
    const agentId = await createDraft();
    await send(agentId, "go");
    await vi.waitFor(() => expect(client.session.runs).toBe(1));
    const interrupted = vi.spyOn(client.session, "interrupt");

    await interrupt(agentId);

    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(count(wire(), "update:idle")).toBe(0);
    client.session.turnGate.resolve();
    await service.turnSettled(agentId);
    expect(count(wire(), "update:idle")).toBe(1);
    expect(rowKinds(agentId)).not.toContain("turn_canceled");
  });
});
