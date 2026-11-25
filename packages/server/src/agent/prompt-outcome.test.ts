import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import { answerThenRun } from "../test-support/answer-then-run.js";
import { AgentManager } from "./agent-manager.js";
import { AgentService } from "./agent-service.js";
import type { CreateAgentAnswer, SendPromptAnswer } from "./agent-service.js";
import type { AgentClient, AgentSession, Unsubscribe } from "./provider-contract.js";
import { MOCK_CAPABILITIES, MockAgentClient } from "./providers/mock/mock-provider.js";
import { PiAgentClient } from "./providers/pi/agent.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./providers/pi/rpc-transport.js";

/**
 * Every prompt the daemon accepts leaves its outcome on the timeline and in the status
 * (sprint-151/task-002): the user's message first, `running` from acceptance, a `turn_failed` row
 * for whatever goes wrong after it, and exactly one `agent_update` that ends it. The RPCs answer
 * when the prompt is accepted (sprint-151/task-003), so a failure after that is a row and a
 * status, never a failed request. `wire` is the order a client sees: `answer` for the RPC's
 * answer, `update:<status>` for an `agent_update` frame and `stream:<kind>` for an `agent_stream`
 * frame.
 */

const NOW = "2026-11-25T12:00:00.000Z";
const ERROR_CAP = 2048;
const NO_SESSION_FILE = "/tmp/pi-outcome-session.jsonl";
const ANSWER_FRAME = { type: "answer" };

type Emit = (event: AgentStreamEvent) => void;
type Script = (emit: Emit) => Promise<void>;

/** A session whose `run` plays `script`, so a test decides exactly what the provider does. */
class ScriptedSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;
  private readonly subscribers = new Set<Emit>();

  constructor(private readonly script: Script) {}

  subscribe(cb: Emit): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }
  startTurn(): Promise<{ turnId: string }> {
    return Promise.resolve({ turnId: "t1" });
  }
  run(): Promise<void> {
    return this.script((event) => {
      for (const cb of this.subscribers) cb(event);
    });
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
}

const completes: Script = async (emit) => {
  emit({ kind: "turn_started" });
  emit({ kind: "assistant_message", text: "reply" });
  emit({ kind: "turn_completed" });
};

/** A client whose spawn and resume are whatever the test sets; both start a completing turn. */
class ScriptedClient extends MockAgentClient {
  onCreate: () => Promise<AgentSession> = () => Promise.resolve(new ScriptedSession(completes));
  onResume: () => Promise<AgentSession> = () => Promise.resolve(new ScriptedSession(completes));

  override createSession(): Promise<AgentSession> {
    return this.onCreate();
  }
  override resumeSession(): Promise<AgentSession> {
    return this.onResume();
  }
}

/** One line per frame a client would act on; any other frame is skipped. */
function describeFrame(frame: unknown): string[] {
  if (typeof frame !== "object" || frame === null || !("type" in frame)) return [];
  if (frame === ANSWER_FRAME) return ["answer"];
  if (frame.type === "agent_update" && "status" in frame) return [`update:${String(frame.status)}`];
  if (frame.type !== "session" || !("message" in frame)) return [];
  const { message } = frame;
  if (typeof message !== "object" || message === null) return [];
  if (!("type" in message) || message.type !== "agent_stream" || !("event" in message)) return [];
  const { event } = message;
  return typeof event === "object" && event !== null && "kind" in event
    ? [`stream:${String(event.kind)}`]
    : [];
}

function harness(client: AgentClient) {
  const frames: unknown[] = [];
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
    broadcast: (_, message) => frames.push(message),
    now: () => NOW,
  });
  const noteAnswer = (): void => {
    frames.push(ANSWER_FRAME);
  };
  /** `create_agent_request` as the router runs it; `answer` marks where the answer falls. */
  const create = (msg: Record<string, unknown>): Promise<CreateAgentAnswer> =>
    answerThenRun((afterReply) => service.handleCreate(msg, () => [], afterReply), noteAnswer);
  /** `send_agent_prompt` as the router runs it. */
  const send = (msg: Record<string, unknown>): Promise<SendPromptAnswer> =>
    answerThenRun((afterReply) => service.handleSendPrompt(msg, () => [], afterReply), noteAnswer);
  const wire = (): string[] => frames.flatMap(describeFrame);
  const events = (agentId: string): AgentStreamEvent[] =>
    manager.timelines
      .get(agentId)
      ?.allRows()
      .map((row) => row.event) ?? [];
  const status = (agentId: string) => manager.get(agentId)?.record.lastStatus;
  /** A draft with no process, as the workbench creates one before its first send. */
  const createDraft = async (): Promise<string> => {
    const { payload } = await create({ config: { provider: "mock", cwd: "/work" } });
    frames.length = 0;
    return payload.agentId;
  };
  return { service, manager, create, send, wire, events, status, createDraft };
}

function failedError(events: AgentStreamEvent[]): string[] {
  return events.flatMap((event) => (event.kind === "turn_failed" ? [event.error ?? ""] : []));
}

function userMessageIds(events: AgentStreamEvent[]): (string | undefined)[] {
  return events.flatMap((event) => (event.kind === "user_message" ? [event.messageId] : []));
}

describe("a prompt whose Pi cannot be started", () => {
  it("create: the answer is a success, then the user message, turn_failed and status error follow", async () => {
    const client = new ScriptedClient();
    client.onCreate = () => Promise.reject(new Error("pi not found on PATH"));
    const { service, create, wire, events, status } = harness(client);

    const { payload } = await create({
      config: { provider: "mock", cwd: "/work" },
      initialPrompt: "hello",
      clientMessageId: "cm-1",
    });
    await service.turnSettled(payload.agentId);

    expect(events(payload.agentId)).toEqual([
      { kind: "user_message", messageId: "cm-1", text: "hello", images: undefined },
      { kind: "turn_failed", error: "pi not found on PATH" },
    ]);
    expect(status(payload.agentId)).toBe("error");
    expect(wire()).toEqual([
      "update:initializing",
      "answer",
      "update:running",
      "stream:user_message",
      "stream:turn_failed",
      "update:error",
    ]);
  });

  it("send: a failed resume records the same, and the next send recovers", async () => {
    const client = new ScriptedClient();
    client.onResume = () => Promise.reject(new Error("cannot resume the session file"));
    const { service, manager, send, wire, events, status, createDraft } = harness(client);
    const agentId = await createDraft();
    await manager.updateRecord(agentId, { persistence: { provider: "mock", sessionId: "s1" } });

    await send({ agentId, prompt: "hi", clientMessageId: "cm-2" });
    await service.turnSettled(agentId);

    expect(events(agentId)).toEqual([
      { kind: "user_message", messageId: "cm-2", text: "hi", images: undefined },
      { kind: "turn_failed", error: "cannot resume the session file" },
    ]);
    expect(status(agentId)).toBe("error");
    expect(wire()).toEqual([
      "answer",
      "update:running",
      "stream:user_message",
      "stream:turn_failed",
      "update:error",
    ]);

    client.onResume = () => Promise.resolve(new ScriptedSession(completes));
    await send({ agentId, prompt: "again" });
    await service.turnSettled(agentId);
    expect(status(agentId)).toBe("idle");
  });
});

describe("a session whose run rejects", () => {
  it("records exactly one turn_failed with the reason and settles to error", async () => {
    const client = new ScriptedClient();
    client.onCreate = () =>
      Promise.resolve(
        new ScriptedSession(() => Promise.reject(new Error("403 Authentication failed"))),
      );
    const { service, send, wire, events, status, createDraft } = harness(client);
    const agentId = await createDraft();

    await send({ agentId, prompt: "go", clientMessageId: "cm-3" });
    await service.turnSettled(agentId);

    expect(events(agentId)).toEqual([
      { kind: "user_message", messageId: "cm-3", text: "go", images: undefined },
      { kind: "turn_failed", error: "403 Authentication failed" },
    ]);
    expect(status(agentId)).toBe("error");
    expect(wire()).toEqual([
      "answer",
      "update:running",
      "stream:user_message",
      "stream:turn_failed",
      "update:error",
    ]);
  });

  it("caps the reason at 2 KiB", async () => {
    const client = new ScriptedClient();
    const long = new Error("x".repeat(ERROR_CAP * 3));
    client.onCreate = () => Promise.resolve(new ScriptedSession(() => Promise.reject(long)));
    const { service, send, events, createDraft } = harness(client);
    const agentId = await createDraft();

    await send({ agentId, prompt: "go" });
    await service.turnSettled(agentId);

    const [reason] = failedError(events(agentId));
    expect(reason).toHaveLength(ERROR_CAP);
  });

  it("adds no second turn_failed when the provider already failed the turn", async () => {
    const client = new ScriptedClient();
    client.onCreate = () =>
      Promise.resolve(
        new ScriptedSession(async (emit) => {
          emit({ kind: "turn_started" });
          emit({ kind: "turn_failed", error: "provider died" });
          throw new Error("provider died");
        }),
      );
    const { service, send, wire, events, status, createDraft } = harness(client);
    const agentId = await createDraft();

    await send({ agentId, prompt: "go" });
    await service.turnSettled(agentId);

    expect(failedError(events(agentId))).toEqual(["provider died"]);
    expect(status(agentId)).toBe("error");
    expect(wire()).toEqual([
      "answer",
      "update:running",
      "stream:user_message",
      "stream:turn_started",
      "stream:turn_failed",
      "update:error",
    ]);
  });
});

describe("a normal turn", () => {
  it("records the user message first, and ends with one idle update", async () => {
    const { service, send, wire, events, status, createDraft } = harness(new ScriptedClient());
    const agentId = await createDraft();

    await send({ agentId, prompt: "go", clientMessageId: "cm-4" });
    await service.turnSettled(agentId);

    expect(events(agentId).map((event) => event.kind)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
    expect(wire()).toEqual([
      "answer",
      "update:running",
      "stream:user_message",
      "stream:turn_started",
      "stream:assistant_message",
      "stream:turn_completed",
      "update:idle",
    ]);
    expect(status(agentId)).toBe("idle");
  });

  it("create with a prompt never reads idle on the way", async () => {
    const { service, create, wire, status } = harness(new ScriptedClient());

    const { payload } = await create({
      config: { provider: "mock", cwd: "/work" },
      initialPrompt: "hello",
    });
    await service.turnSettled(payload.agentId);

    expect(wire()).toEqual([
      "update:initializing",
      "answer",
      "update:running",
      "stream:user_message",
      "stream:turn_started",
      "stream:assistant_message",
      "stream:turn_completed",
      "update:idle",
    ]);
    expect(status(payload.agentId)).toBe("idle");
  });

  it.each([
    ["the same id", "cm-5"],
    ["no id", undefined],
  ])("records one user message when the provider echoes it with %s", async (_label, echoedId) => {
    const client = new ScriptedClient();
    client.onCreate = () =>
      Promise.resolve(
        new ScriptedSession(async (emit) => {
          emit({ kind: "user_message", messageId: echoedId, text: "go" });
          await completes(emit);
        }),
      );
    const { service, send, events, createDraft } = harness(client);
    const agentId = await createDraft();

    await send({ agentId, prompt: "go", clientMessageId: "cm-5" });
    await service.turnSettled(agentId);

    expect(userMessageIds(events(agentId))).toEqual(["cm-5"]);
  });
});

/** A Pi process that answers every `prompt` request as an extension command it handled inline. */
class InlineCommandProcess implements PiRpcTransport {
  private readonly eventCbs = new Set<(e: unknown) => void>();

  constructor(readonly spawnArgs: PiTransportSpawnArgs) {}

  request(command: string): Promise<unknown> {
    if (command === "get_state") return Promise.resolve({ sessionFile: NO_SESSION_FILE });
    if (command === "prompt") return Promise.resolve({ disposition: "handled" });
    return Promise.resolve({ cancelled: false });
  }
  notify(): void {}
  onEvent(cb: (e: unknown) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe("a slash command an extension handles inline", () => {
  it("leaves the user message and one idle update, and no turn_* row", async () => {
    const pi = new PiAgentClient({
      command: ["pi", "--mode", "rpc"],
      binaryResolver: () => true,
      transportFactory: (args) => new InlineCommandProcess(args),
    });
    const { service, create, wire, events, status } = harness(pi);

    const { payload } = await create({
      config: { provider: "pi", cwd: "/work" },
      initialPrompt: "/my-command arg",
    });
    await service.turnSettled(payload.agentId);

    expect(events(payload.agentId).map((event) => event.kind)).toEqual(["user_message"]);
    expect(wire()).toEqual([
      "update:initializing",
      "answer",
      "update:running",
      "stream:user_message",
      "update:idle",
    ]);
    expect(status(payload.agentId)).toBe("idle");
  });
});

describe("an agent closed while its session starts", () => {
  it.each([
    ["archived", (manager: AgentManager, agentId: string) => manager.archiveAgent(agentId)],
    ["deleted", (manager: AgentManager, agentId: string) => manager.deleteAgent(agentId)],
  ])("%s: no turn_failed and no settling update follow", async (_label, close) => {
    const client = new ScriptedClient();
    const resumeStarted = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<AgentSession>();
    client.onResume = () => {
      resumeStarted.resolve();
      return resume.promise;
    };
    const { service, manager, send, wire, createDraft } = harness(client);
    const agentId = await createDraft();
    await manager.updateRecord(agentId, { persistence: { provider: "mock", sessionId: "s1" } });

    await send({ agentId, prompt: "go" });
    await resumeStarted.promise;
    await close(manager, agentId);
    resume.resolve(new ScriptedSession(completes));
    await service.turnSettled(agentId);

    expect(wire()).not.toContain("stream:turn_failed");
    expect(wire()).not.toContain("update:error");
    expect(wire()).not.toContain("update:idle");
  });
});
