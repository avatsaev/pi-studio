import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { AgentTodoList, PersistenceHandle } from "../../provider-contract.js";

import { PI_CAPABILITIES, PiAgentClient } from "./agent.js";
import { createPiEventMapper } from "./event-mapper.js";
import type { PiRpcTransport, PiTransportSpawnArgs } from "./rpc-transport.js";
import { TODO_STATE_ENTRY_TYPE } from "./todos.js";

/**
 * Fixtures recorded against real Pi 1.4.0 + `@juicesharp/rpiv-todo@2.15.0` (sprint-079/task-001),
 * matching `todos.test.ts`'s own fixtures.
 */
const createdDetails = {
  action: "create",
  params: { action: "create", tasks: [{ subject: "Alpha" }, { subject: "Beta" }] },
  tasks: [
    { id: 1, subject: "Alpha", status: "pending" },
    { id: 2, subject: "Beta", status: "pending" },
  ],
  nextId: 3,
};

const entryAppendedFrame = (data: unknown) => ({
  type: "entry_appended",
  entry: { type: "custom", customType: TODO_STATE_ENTRY_TYPE, data },
});

const toolExecutionEndFrame = (
  details: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: "tool_execution_end",
  toolCallId: "toolu_1",
  toolName: "todo",
  result: { content: [{ type: "text", text: "ok" }], details },
  isError: false,
  ...extra,
});

/** Minimal fake transport: `sessionFile` is reported by `get_state` (so `createSession`'s own
 *  `discoverState()` call picks it up, same as `pi-adapter.test.ts`'s `FakeTransport`), and
 *  `switch_session`/`fork`/`new_session`/`clone` rebind it — the real rebind path exercised by
 *  `refreshSessionFile()`. `fireRaw` injects a raw RPC frame directly. */
class FakeTransport implements PiRpcTransport {
  sessionFile: string;
  private readonly eventCbs = new Set<(e: unknown) => void>();

  constructor(
    public readonly spawnArgs: PiTransportSpawnArgs,
    initialSessionFile = "/tmp/fake-pi-todos-session.jsonl",
  ) {
    this.sessionFile = initialSessionFile;
  }

  request(command: string, params?: Record<string, unknown>): Promise<unknown> {
    if (command === "switch_session" && typeof params?.sessionPath === "string") {
      this.sessionFile = params.sessionPath;
    } else if (command === "fork") {
      this.sessionFile = typeof params?.nextFile === "string" ? params.nextFile : this.sessionFile;
    }
    if (command === "get_state") {
      return Promise.resolve({ sessionFile: this.sessionFile, model: { id: "claude-opus-4" } });
    }
    if (command === "fork") return Promise.resolve({ text: "forked", cancelled: false });
    return Promise.resolve({});
  }

  notify(): void {
    /* unused by these tests */
  }

  fireRaw(event: unknown): void {
    for (const cb of this.eventCbs) cb(event);
  }

  onEvent(cb: (e: unknown) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function clientWithFake(initialSessionFile?: string): {
  client: PiAgentClient;
  spawns: FakeTransport[];
} {
  const spawns: FakeTransport[] = [];
  const client = new PiAgentClient({
    command: ["pi", "--mode", "rpc"],
    transportFactory: (args) => {
      const t = new FakeTransport(args, initialSessionFile);
      spawns.push(t);
      return t;
    },
    binaryResolver: () => true,
  });
  return { client, spawns };
}

function makeSessionManager(): SessionManager {
  const dir = mkdtempSync(join(tmpdir(), "pi-todos-wiring-"));
  return SessionManager.create("/work", dir);
}

describe("PI_CAPABILITIES", () => {
  it("advertises supportsTodos", () => {
    expect(PI_CAPABILITIES.supportsTodos).toBe(true);
  });
});

describe("PiAgentSession onTodos", () => {
  it("delivers a validated snapshot for an entry_appended rpiv-todo-state frame", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const received: AgentTodoList[] = [];
    session.onTodos!((list) => received.push(list));

    spawns[0]!.fireRaw(entryAppendedFrame(createdDetails));

    expect(received).toHaveLength(1);
    expect(received[0]!.tasks.map((t) => t.subject)).toEqual(["Alpha", "Beta"]);
    expect(received[0]!.truncated).toBe(false);
  });

  it("delivers a validated snapshot for a todo tool_execution_end frame", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const received: AgentTodoList[] = [];
    session.onTodos!((list) => received.push(list));

    spawns[0]!.fireRaw(toolExecutionEndFrame(createdDetails));

    expect(received).toHaveLength(1);
    expect(received[0]!.tasks.map((t) => t.subject)).toEqual(["Alpha", "Beta"]);
  });

  it("delivers a nested frame carrying parentToolCallId (no filter on purpose)", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const received: AgentTodoList[] = [];
    session.onTodos!((list) => received.push(list));

    spawns[0]!.fireRaw(toolExecutionEndFrame(createdDetails, { parentToolCallId: "toolu_outer" }));

    expect(received).toHaveLength(1);
  });

  it("reaches no subscriber for invalid details", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const received: AgentTodoList[] = [];
    session.onTodos!((list) => received.push(list));

    spawns[0]!.fireRaw(toolExecutionEndFrame({ not: "valid" }));
    spawns[0]!.fireRaw(entryAppendedFrame({ not: "valid" }));

    expect(received).toHaveLength(0);
  });

  it("stops delivery after unsubscribe", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const received: AgentTodoList[] = [];
    const unsub = session.onTodos!((list) => received.push(list));

    spawns[0]!.fireRaw(toolExecutionEndFrame(createdDetails));
    unsub();
    spawns[0]!.fireRaw(toolExecutionEndFrame(createdDetails));

    expect(received).toHaveLength(1);
  });

  it("mapped timeline output for the same frames is byte-identical to before (regression)", async () => {
    const { client, spawns } = clientWithFake();
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((e) => events.push(e));

    const endFrame = toolExecutionEndFrame(createdDetails);
    spawns[0]!.fireRaw(entryAppendedFrame(createdDetails));
    spawns[0]!.fireRaw(endFrame);

    // `entry_appended` maps to no timeline event; `tool_execution_end` maps to exactly the same
    // event the plain event mapper produces for it — the todo fan-out runs alongside, not instead
    // of, the existing mapping.
    const expected = createPiEventMapper().map(endFrame);
    expect(events).toEqual(expected ? [expected] : []);
  });
});

describe("PiAgentSession.readTodos", () => {
  it("replays the current session file's branch", async () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
    sm.appendCustomEntry(TODO_STATE_ENTRY_TYPE, createdDetails);
    const sessionFile = sm.getSessionFile() as string;

    const { client } = clientWithFake(sessionFile);
    const session = await client.createSession({ provider: "pi", cwd: "/work" });

    expect(session.readTodos!().tasks.map((t) => t.subject)).toEqual(["Alpha", "Beta"]);
  });

  it("returns an empty list when the session has no file yet", async () => {
    const spawns: FakeTransport[] = [];
    const client = new PiAgentClient({
      command: ["pi", "--mode", "rpc"],
      transportFactory: (args) => {
        const t = new FakeTransport(args);
        // Simulate a process that hasn't reported a sessionFile at all.
        t.sessionFile = "";
        spawns.push(t);
        return t;
      },
      binaryResolver: () => true,
    });
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(session.readTodos!()).toEqual({ tasks: [], truncated: false });
  });

  it("follows the session file rebind after switch_session", async () => {
    const sm1 = makeSessionManager();
    sm1.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
    sm1.appendCustomEntry(TODO_STATE_ENTRY_TYPE, createdDetails);

    const { client } = clientWithFake(sm1.getSessionFile() as string);
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(session.readTodos!().tasks).toHaveLength(2);

    const sm2 = makeSessionManager();
    const secondDetails = {
      action: "create",
      params: { action: "create", tasks: [{ subject: "Solo" }] },
      tasks: [{ id: 1, subject: "Solo", status: "pending" }],
      nextId: 2,
    };
    sm2.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
    sm2.appendCustomEntry(TODO_STATE_ENTRY_TYPE, secondDetails);

    await session.switchSession!(sm2.getSessionFile() as string);

    expect(session.readTodos!().tasks.map((t) => t.subject)).toEqual(["Solo"]);
  });

  it("throws on an unreadable session file", async () => {
    const { client } = clientWithFake("/no/such/directory/missing.jsonl");
    const session = await client.createSession({ provider: "pi", cwd: "/work" });
    expect(() => session.readTodos!()).toThrow();
  });
});

describe("PiAgentClient.readTodos", () => {
  it("reads the file at handle.nativeHandle without spawning a process", () => {
    const { client, spawns } = clientWithFake();
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "start", timestamp: Date.now() });
    sm.appendCustomEntry(TODO_STATE_ENTRY_TYPE, createdDetails);
    const handle: PersistenceHandle = {
      provider: client.provider,
      sessionId: "irrelevant",
      nativeHandle: sm.getSessionFile() as string,
    };

    const list = client.readTodos!(handle);

    expect(list.tasks.map((t) => t.subject)).toEqual(["Alpha", "Beta"]);
    expect(spawns).toHaveLength(0);
  });

  it("returns an empty list for a handle with no nativeHandle", () => {
    const { client } = clientWithFake();
    expect(client.readTodos!({ provider: client.provider, sessionId: "x" })).toEqual({
      tasks: [],
      truncated: false,
    });
  });
});
