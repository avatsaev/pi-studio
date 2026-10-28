import type { AgentTodosSnapshot } from "@av-pi-studio/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLAPSE_WRITE_DEBOUNCE_MS,
  createAgentTodosStore,
  type AgentTodosStoreDeps,
} from "./agent-todos-store.js";
import { TODO_COLLAPSE_STORAGE_KEY } from "./todo-collapse-codec.js";

const snap = (agentId: string, seq: number, n = 1): AgentTodosSnapshot => ({
  agentId,
  seq,
  tasks: Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    subject: `t${i + 1}`,
    status: "pending" as const,
  })),
});

function setup(opts: { capable?: boolean; kv?: Record<string, string> } = {}) {
  const data = new Map(Object.entries(opts.kv ?? {}));
  const list = vi.fn<(agentId: string) => Promise<AgentTodosSnapshot>>();
  const client: NonNullable<ReturnType<AgentTodosStoreDeps["getClient"]>> = {
    hasAgentTodosCapability: () => opts.capable ?? true,
    listAgentTodos: list,
  };
  const set = vi.fn((k: string, v: string) => void data.set(k, v));
  const store = createAgentTodosStore({
    getClient: () => client,
    kv: { get: (k) => data.get(k) ?? null, set },
  });
  return { store, list, set, data };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe("agent todos store", () => {
  it("lists once per agent however many panels track it", async () => {
    const { store, list } = setup();
    list.mockResolvedValue(snap("a", 1, 2));
    const r1 = store.getState().track("a");
    const r2 = store.getState().track("a");
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.getState().todos.byAgent["a"]?.tasks).toHaveLength(2);
    r1();
    expect(store.getState().tracked["a"]).toBe(1);
    r2();
    r2(); // double release is a no-op
    expect(store.getState().tracked["a"]).toBeUndefined();
  });

  it("keeps the prior snapshot when a list rejects", async () => {
    const { store, list } = setup();
    store.getState().applyUpdate(snap("a", 3, 2));
    list.mockRejectedValue(new Error("not_found"));
    store.getState().track("a");
    await flush();
    expect(store.getState().todos.byAgent["a"]?.seq).toBe(3);
  });

  it("drops a stale push", () => {
    const { store } = setup();
    store.getState().applyUpdate(snap("a", 5, 2));
    store.getState().applyUpdate(snap("a", 4, 1));
    expect(store.getState().todos.byAgent["a"]?.tasks).toHaveLength(2);
  });

  it("after a reconnect refetch, a seq-1 list replaces a seq-7 snapshot", async () => {
    const { store, list } = setup();
    list.mockResolvedValueOnce(snap("a", 7, 3));
    store.getState().track("a");
    await flush();
    list.mockResolvedValueOnce(snap("a", 1, 1));
    await store.getState().refetchTracked();
    expect(store.getState().todos.byAgent["a"]).toMatchObject({ seq: 1 });
    expect(store.getState().todos.byAgent["a"]?.tasks).toHaveLength(1);
  });

  it("sends no request without the capability", async () => {
    const { store, list } = setup({ capable: false });
    store.getState().track("a");
    await store.getState().refetchTracked();
    expect(list).not.toHaveBeenCalled();
  });

  it("restores collapsed ids and debounces writes", () => {
    vi.useFakeTimers();
    const { store, set, data } = setup({
      kv: { [TODO_COLLAPSE_STORAGE_KEY]: '{"version":1,"collapsed":["x"]}' },
    });
    expect(store.getState().collapsed.has("x")).toBe(true);
    store.getState().setCollapsed("a", true);
    store.getState().setCollapsed("b", true);
    store.getState().setCollapsed("x", false);
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COLLAPSE_WRITE_DEBOUNCE_MS);
    expect(set).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(TODO_COLLAPSE_STORAGE_KEY)!)).toEqual({
      version: 1,
      collapsed: ["a", "b"],
    });
  });
});
