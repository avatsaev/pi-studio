import type { AgentStreamEvent, AgentTodo } from "@av-pi-studio/protocol";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { ManagedAgent } from "../agent-manager.js";
import type { AgentClient, AgentSession, AgentTodoList } from "../provider-contract.js";
import { AgentTodosService } from "./agent-todos-service.js";

const todo = (id: number, status: AgentTodo["status"] = "pending"): AgentTodo => ({
  id,
  subject: `task ${id}`,
  status,
});
const listOf = (...tasks: AgentTodo[]): AgentTodoList => ({ tasks, truncated: false });

/** A session with controllable `onTodos`/stream channels and a `readTodos` that returns `current`. */
function fakeSession(opts: { members?: boolean } = {}) {
  const todoSubs = new Set<(list: AgentTodoList) => void>();
  const streamSubs = new Set<(event: AgentStreamEvent) => void>();
  const state = { current: listOf(), reads: 0, failWith: undefined as Error | undefined };
  const base = {
    subscribe(cb: (event: AgentStreamEvent) => void) {
      streamSubs.add(cb);
      return () => streamSubs.delete(cb);
    },
  };
  const withMembers = {
    onTodos(cb: (list: AgentTodoList) => void) {
      todoSubs.add(cb);
      return () => todoSubs.delete(cb);
    },
    readTodos(): AgentTodoList {
      state.reads += 1;
      if (state.failWith) throw state.failWith;
      return state.current;
    },
  };
  return {
    session: (opts.members === false
      ? base
      : { ...base, ...withMembers }) as unknown as AgentSession,
    state,
    emit: (list: AgentTodoList) => {
      for (const cb of todoSubs) cb(list);
    },
    stream: (event: AgentStreamEvent) => {
      for (const cb of streamSubs) cb(event);
    },
    todoSubscribers: () => todoSubs.size,
    streamSubscribers: () => streamSubs.size,
  };
}

function setup(agents: Record<string, { session?: AgentSession; handle?: object }> = {}) {
  const broadcast = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const readFromHandle = vi.fn<(handle: unknown) => AgentTodoList>(() => listOf());
  const createSession = vi.fn();
  const client = {
    provider: "pi",
    readTodos: readFromHandle,
    createSession,
  } as unknown as AgentClient;
  const service = new AgentTodosService({
    broadcast,
    getActiveSessions: () => [],
    getAgent: (id) => {
      const a = agents[id];
      if (!a) return undefined;
      return {
        record: { id, provider: "pi", persistence: a.handle },
        session: a.session ?? null,
        parentAgentId: null,
      } as unknown as ManagedAgent;
    },
    resolveClient: () => client,
    logger: logger as never,
  });
  return { service, broadcast, logger, readFromHandle, createSession };
}

/** Every broadcast is `{type:"session", message}` — unwrap to the inner messages. */
const sent = (broadcast: Mock) =>
  broadcast.mock.calls.map((c) => (c[1] as { message: Record<string, unknown> }).message);

const turnDone = { kind: "turn_completed" } as AgentStreamEvent;

describe("AgentTodosService", () => {
  it("broadcasts an onTodos emission with seq + 1, and nothing for an identical one", () => {
    const f = fakeSession();
    const { service, broadcast } = setup({ a1: { session: f.session } });
    service.attach("a1", f.session);
    expect(broadcast).not.toHaveBeenCalled(); // a fresh agent with no todos says nothing

    f.emit(listOf(todo(1)));
    f.emit(listOf(todo(1))); // Pi announces one call twice: entry_appended then tool_execution_end
    f.emit(listOf(todo(1, "in_progress")));

    const messages = sent(broadcast);
    expect(messages.map((m) => m.type)).toEqual(["agent_todos_update", "agent_todos_update"]);
    expect(messages.map((m) => (m.snapshot as { seq: number }).seq)).toEqual([1, 2]);
    expect(messages[1]!.snapshot).toMatchObject({
      agentId: "a1",
      tasks: [{ id: 1, status: "in_progress" }],
    });
  });

  it("carries truncated only when tasks were dropped", () => {
    const f = fakeSession();
    const { service, broadcast } = setup({ a1: { session: f.session } });
    service.attach("a1", f.session);
    f.emit({ tasks: [todo(1)], truncated: true });
    f.emit({ tasks: [todo(1)], truncated: false });
    const [first, second] = sent(broadcast).map((m) => m.snapshot as Record<string, unknown>);
    expect(first!.truncated).toBe(true);
    expect(second).not.toHaveProperty("truncated");
  });

  it("reconciles on turn terminals and a completed compaction, and on nothing else", () => {
    const f = fakeSession();
    const { service, broadcast } = setup({ a1: { session: f.session } });
    service.attach("a1", f.session);
    const seedReads = f.state.reads;

    f.stream({ kind: "turn_started" } as AgentStreamEvent);
    f.stream({ kind: "compaction", phase: "started" } as AgentStreamEvent);
    f.stream({ kind: "assistant_message" } as unknown as AgentStreamEvent);
    expect(f.state.reads).toBe(seedReads);

    for (const event of [
      { kind: "turn_completed" },
      { kind: "turn_failed", error: "x" },
      { kind: "turn_canceled" },
      { kind: "compaction", phase: "completed" },
    ] as AgentStreamEvent[]) {
      f.stream(event);
    }
    expect(f.state.reads).toBe(seedReads + 4);
    expect(broadcast).not.toHaveBeenCalled(); // state never changed: no spurious broadcast
  });

  it("catches a write live events missed: a settled turn publishes the file's list", () => {
    const f = fakeSession();
    const { service, broadcast } = setup({ a1: { session: f.session } });
    service.attach("a1", f.session);
    f.state.current = listOf(todo(1), todo(2));
    f.stream(turnDone);
    expect(sent(broadcast)).toHaveLength(1);
    expect(sent(broadcast)[0]!.snapshot).toMatchObject({ seq: 1, tasks: [{ id: 1 }, { id: 2 }] });
  });

  it("seeds from the session file on attach", () => {
    const f = fakeSession();
    f.state.current = listOf(todo(4, "completed"));
    const { service, broadcast } = setup({ a1: { session: f.session } });
    service.attach("a1", f.session);
    expect(sent(broadcast)[0]!.snapshot).toMatchObject({ seq: 1, tasks: [{ id: 4 }] });
  });

  it("re-attach drops the old session's subscriptions and ignores its emissions", () => {
    const oldS = fakeSession();
    const newS = fakeSession();
    const { service, broadcast } = setup({ a1: { session: newS.session } });
    service.attach("a1", oldS.session);
    service.attach("a1", newS.session);
    expect(oldS.todoSubscribers()).toBe(0);
    expect(oldS.streamSubscribers()).toBe(0);

    oldS.emit(listOf(todo(9)));
    oldS.stream(turnDone);
    expect(broadcast).not.toHaveBeenCalled();

    newS.emit(listOf(todo(1)));
    expect(sent(broadcast)).toHaveLength(1);
  });

  it("re-attach with an equal seed does not flicker the panel", () => {
    const first = fakeSession();
    first.state.current = listOf(todo(1));
    const second = fakeSession();
    second.state.current = listOf(todo(1));
    const { service, broadcast } = setup({ a1: { session: second.session } });
    service.attach("a1", first.session);
    service.attach("a1", second.session);
    expect(sent(broadcast)).toHaveLength(1);
  });

  it("a session without the optional members gets no subscription and lists empty", () => {
    const f = fakeSession({ members: false });
    const { service, broadcast } = setup({ a1: { session: f.session } });
    service.attach("a1", f.session);
    expect(f.streamSubscribers()).toBe(0);
    expect(service.list("a1")).toEqual({
      ok: true,
      snapshot: { agentId: "a1", seq: 0, tasks: [] },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  describe("list", () => {
    it("is not_found for an unknown agent", () => {
      const { service } = setup();
      expect(service.list("nope")).toEqual({ ok: false, error: "not_found" });
    });

    it("reads a process-less record once through the client, then serves the cache; never spawns", () => {
      const { service, readFromHandle, createSession, broadcast } = setup({
        a1: { handle: { provider: "pi", nativeHandle: "/f.jsonl" } },
      });
      readFromHandle.mockReturnValue(listOf(todo(1), todo(2, "completed")));
      const first = service.list("a1");
      const second = service.list("a1");
      expect(readFromHandle).toHaveBeenCalledTimes(1);
      expect(readFromHandle).toHaveBeenCalledWith({ provider: "pi", nativeHandle: "/f.jsonl" });
      expect(createSession).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        ok: true,
        snapshot: { seq: 1, tasks: [{ id: 1 }, { id: 2 }] },
      });
    });

    it("answers empty for a process-less record without a handle or without client support", () => {
      const { service, readFromHandle } = setup({ a1: {} });
      expect(service.list("a1")).toEqual({
        ok: true,
        snapshot: { agentId: "a1", seq: 0, tasks: [] },
      });
      expect(readFromHandle).not.toHaveBeenCalled();
    });

    it("loads a live agent's list without broadcasting, and a later change continues the seq", () => {
      const f = fakeSession();
      f.state.current = listOf(todo(1));
      const { service, broadcast } = setup({ a1: { session: f.session } });
      // Listed before attach ever ran (e.g. attach raced the first list).
      const listed = service.list("a1");
      expect(listed).toMatchObject({ ok: true, snapshot: { seq: 1 } });
      expect(broadcast).not.toHaveBeenCalled();

      service.attach("a1", f.session); // equal to what was listed: still silent
      expect(broadcast).not.toHaveBeenCalled();
      f.emit(listOf(todo(1, "completed")));
      expect(sent(broadcast)[0]!.snapshot).toMatchObject({ seq: 2 });
    });

    it("warns with the agent id only and answers an empty snapshot when a read throws", () => {
      const { service, readFromHandle, logger } = setup({ a1: { handle: { provider: "pi" } } });
      readFromHandle.mockImplementation(() => {
        throw new Error("ENOENT: no such file");
      });
      expect(service.list("a1")).toEqual({
        ok: true,
        snapshot: { agentId: "a1", seq: 0, tasks: [] },
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [fields] = logger.warn.mock.calls[0]!;
      expect(fields).toMatchObject({ agentId: "a1", err: "ENOENT: no such file" });

      // A transient failure is retried by the next list, not remembered.
      readFromHandle.mockReturnValue(listOf(todo(1)));
      expect(service.list("a1")).toMatchObject({ snapshot: { tasks: [{ id: 1 }] } });
    });

    it("a throwing reconcile read keeps the last list and logs no task text", () => {
      const f = fakeSession();
      const { service, broadcast, logger } = setup({ a1: { session: f.session } });
      service.attach("a1", f.session);
      f.emit(listOf({ ...todo(1), subject: "SECRET subject" }));
      f.state.failWith = new Error("boom");
      f.stream(turnDone);
      expect(sent(broadcast)).toHaveLength(1);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("SECRET");
      expect(service.list("a1")).toMatchObject({
        snapshot: { tasks: [{ subject: "SECRET subject" }] },
      });
    });
  });

  describe("reconcile without a live session", () => {
    it("drops the cache so the next list re-reads the file", () => {
      const { service, readFromHandle } = setup({ a1: { handle: { provider: "pi" } } });
      readFromHandle.mockReturnValueOnce(listOf(todo(1)));
      service.list("a1");
      readFromHandle.mockReturnValueOnce(listOf(todo(1), todo(2)));
      service.reconcile("a1");
      const after = service.list("a1");
      expect(readFromHandle).toHaveBeenCalledTimes(2);
      expect(after).toMatchObject({ snapshot: { seq: 2, tasks: [{ id: 1 }, { id: 2 }] } });
    });
  });

  describe("sweep", () => {
    it("broadcasts an empty snapshot with seq + 1, and a later attach continues upward", () => {
      const f = fakeSession();
      const { service, broadcast } = setup({ a1: { session: f.session } });
      service.attach("a1", f.session);
      f.emit(listOf(todo(1)));
      f.emit(listOf(todo(1), todo(2)));

      service.sweep("a1");
      const messages = sent(broadcast);
      expect(messages.at(-1)!.snapshot).toMatchObject({ agentId: "a1", seq: 3, tasks: [] });
      expect(f.todoSubscribers()).toBe(0);
      f.emit(listOf(todo(7))); // ignored: unsubscribed
      expect(sent(broadcast)).toHaveLength(3);

      const revived = fakeSession();
      revived.state.current = listOf(todo(1));
      service.attach("a1", revived.session);
      expect(sent(broadcast).at(-1)!.snapshot).toMatchObject({ seq: 4, tasks: [{ id: 1 }] });
    });

    it("broadcasts nothing when there was no list", () => {
      const f = fakeSession();
      const { service, broadcast } = setup({ a1: { session: f.session } });
      service.attach("a1", f.session);
      service.sweep("a1");
      service.sweep("never-seen");
      expect(broadcast).not.toHaveBeenCalled();
    });
  });
});
