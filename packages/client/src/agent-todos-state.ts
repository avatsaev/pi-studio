import type { AgentTodosSnapshot } from "@av-pi-studio/protocol";

/**
 * Framework-free `agent_todos_*` state (`swe/features/agent-todos.md` § SDK, sprint-079/task-008).
 * No DOM, no I/O, no timers — mirrors `agent-ui-state.ts`'s pure-module convention.
 *
 * `seq` is per-agent, strictly increasing within one daemon process lifetime, and restarts at 1
 * after a daemon restart. This module tracks the last-applied seq inline on the stored snapshot
 * (there is no separate `lastSeq` field — `AgentTodosState` is exactly `{byAgent}`, per the task
 * spec) and drops anything `seq <= lastSeq`. `resetAgentTodosSeq` lowers every stored seq to
 * `-Infinity` so the *next* snapshot of any seq (including a fresh daemon's `1`) always wins,
 * without discarding the previously-rendered tasks in the meantime. The consumer (sprint-080's
 * store) calls it on every reconnect (new `server_info`) and immediately refetches via `list`, so
 * the `-Infinity` seq is never itself rendered.
 */

// ─── State shape ──────────────────────────────────────────────────────────────

export interface AgentTodosState {
  byAgent: Record<string, AgentTodosSnapshot>;
}

export const initialAgentTodosState: AgentTodosState = { byAgent: {} };

// ─── Reducer ──────────────────────────────────────────────────────────────────

/**
 * Last-value-wins per agent. Ignores `seq <= lastSeq` for that agent (stale or duplicate
 * delivery) and returns the **same** `state` object when ignored, so a React selector keyed off
 * `state` reference never re-renders for a dropped push. A `list` response is applied through
 * this same function — there is no separate code path for it.
 */
export function applyAgentTodosSnapshot(
  state: AgentTodosState,
  snapshot: AgentTodosSnapshot,
): AgentTodosState {
  const current = state.byAgent[snapshot.agentId];
  if (current && snapshot.seq <= current.seq) return state;
  return { byAgent: { ...state.byAgent, [snapshot.agentId]: snapshot } };
}

/**
 * Keeps every agent's last-known snapshot (tasks stay visible) but lowers its tracked seq to
 * `-Infinity`, so the next `applyAgentTodosSnapshot` call for that agent wins regardless of its
 * seq value. Call on every reconnect (new `server_info`), before refetching via `list`.
 */
export function resetAgentTodosSeq(state: AgentTodosState): AgentTodosState {
  const byAgent: Record<string, AgentTodosSnapshot> = {};
  for (const [agentId, snapshot] of Object.entries(state.byAgent)) {
    byAgent[agentId] = { ...snapshot, seq: Number.NEGATIVE_INFINITY };
  }
  return { byAgent };
}

// ─── Selectors ────────────────────────────────────────────────────────────────

/** The last-applied snapshot for one agent, or `undefined` if none has arrived yet. */
export function snapshotFor(
  state: AgentTodosState,
  agentId: string,
): AgentTodosSnapshot | undefined {
  return state.byAgent[agentId];
}
