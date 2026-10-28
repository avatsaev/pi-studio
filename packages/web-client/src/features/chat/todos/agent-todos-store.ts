/**
 * Agent todos store (swe/features/agent-todos-ui.md). Holds every agent's last snapshot (through the
 * SDK's pure reducer) and the per-agent collapse flag. One push subscription per connection lives in
 * `hooks/use-agent-todos.ts`; panels only `track()` the agent they show.
 *
 * A failed list keeps whatever snapshot exists and says nothing: the panel is read-only context, so
 * an error toast would be noise. The daemon restarts `seq` at 1, so a reconnect resets the tracked
 * seq (`refetchTracked`) before listing again.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  applyAgentTodosSnapshot,
  initialAgentTodosState,
  resetAgentTodosSeq,
  snapshotFor,
  type AgentTodosState,
  type PiStudioClient,
} from "@av-pi-studio/client";
import type { AgentTodosSnapshot } from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { localKvStore } from "@pi-studio-ui/providers/kv-store.js";
import type { KeyValueStore } from "@pi-studio-ui/theme/appearance-store.js";
import {
  parseCollapsed,
  serializeCollapsed,
  TODO_COLLAPSE_STORAGE_KEY,
} from "./todo-collapse-codec.js";

export const COLLAPSE_WRITE_DEBOUNCE_MS = 250;

export interface AgentTodosStoreState {
  todos: AgentTodosState;
  /** agentId -> number of panels showing it. */
  tracked: Record<string, number>;
  collapsed: ReadonlySet<string>;
  /** Start showing `agentId`; the returned release stops it. Lists once per agent. */
  track(agentId: string): () => void;
  refetchTracked(): Promise<void>;
  applyUpdate(snapshot: AgentTodosSnapshot): void;
  clear(): void;
  setCollapsed(agentId: string, collapsed: boolean): void;
}

export interface AgentTodosStoreDeps {
  getClient: () => Pick<PiStudioClient, "hasAgentTodosCapability" | "listAgentTodos"> | null;
  kv: KeyValueStore;
}

export function createAgentTodosStore(
  deps: AgentTodosStoreDeps,
): UseBoundStore<StoreApi<AgentTodosStoreState>> {
  let writeTimer: ReturnType<typeof setTimeout> | undefined;

  const listOne = async (agentId: string): Promise<void> => {
    const client = deps.getClient();
    if (!client?.hasAgentTodosCapability()) return;
    try {
      const snapshot = await client.listAgentTodos(agentId);
      store.getState().applyUpdate(snapshot);
    } catch {
      // Keep the last snapshot; a read-only panel never toasts.
    }
  };

  const store = create<AgentTodosStoreState>()((set, get) => ({
    todos: initialAgentTodosState,
    tracked: {},
    collapsed: parseCollapsed(deps.kv.get(TODO_COLLAPSE_STORAGE_KEY)),

    track(agentId) {
      const first = (get().tracked[agentId] ?? 0) === 0;
      set((s) => ({ tracked: { ...s.tracked, [agentId]: (s.tracked[agentId] ?? 0) + 1 } }));
      if (first) void listOne(agentId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set((s) => {
          const { [agentId]: count = 0, ...rest } = s.tracked;
          return { tracked: count > 1 ? { ...rest, [agentId]: count - 1 } : rest };
        });
      };
    },

    async refetchTracked() {
      set((s) => ({ todos: resetAgentTodosSeq(s.todos) }));
      await Promise.all(Object.keys(get().tracked).map(listOne));
    },

    applyUpdate(snapshot) {
      set((s) => {
        const next = applyAgentTodosSnapshot(s.todos, snapshot);
        return next === s.todos ? s : { todos: next };
      });
    },

    clear() {
      set({ todos: initialAgentTodosState });
    },

    setCollapsed(agentId, collapsed) {
      const next = new Set(get().collapsed);
      next.delete(agentId); // re-insert so the newest toggle is the youngest entry
      if (collapsed) next.add(agentId);
      set({ collapsed: next });
      clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        deps.kv.set(TODO_COLLAPSE_STORAGE_KEY, serializeCollapsed(get().collapsed));
      }, COLLAPSE_WRITE_DEBOUNCE_MS);
    },
  }));
  return store;
}

export const useAgentTodosStore = createAgentTodosStore({
  getClient: () => useConnectionStore.getState().client,
  kv: localKvStore,
});

export function useAgentTodosSnapshot(agentId: string | null): AgentTodosSnapshot | undefined {
  return useAgentTodosStore((s) => (agentId ? snapshotFor(s.todos, agentId) : undefined));
}

export function useTodoPanelCollapsed(agentId: string | null): boolean {
  return useAgentTodosStore((s) => (agentId ? s.collapsed.has(agentId) : false));
}
