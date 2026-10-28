import type { AgentTodosSnapshot } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import {
  type AgentTodosState,
  applyAgentTodosSnapshot,
  initialAgentTodosState,
  resetAgentTodosSeq,
  snapshotFor,
} from "./agent-todos-state.js";

function makeSnapshot(overrides: Partial<AgentTodosSnapshot> = {}): AgentTodosSnapshot {
  return {
    agentId: "agent-1",
    seq: 1,
    tasks: [],
    ...overrides,
  };
}

describe("agent-todos-state", () => {
  it("applyAgentTodosSnapshot stores the first snapshot for a new agent", () => {
    const snapshot = makeSnapshot({ seq: 1, tasks: [{ id: 1, subject: "a", status: "pending" }] });
    const state = applyAgentTodosSnapshot(initialAgentTodosState, snapshot);
    expect(snapshotFor(state, "agent-1")).toEqual(snapshot);
  });

  it("drops a stale (lower) seq and returns the same state object", () => {
    const first = applyAgentTodosSnapshot(initialAgentTodosState, makeSnapshot({ seq: 5 }));
    const second = applyAgentTodosSnapshot(first, makeSnapshot({ seq: 3 }));
    expect(second).toBe(first);
    expect(snapshotFor(second, "agent-1")?.seq).toBe(5);
  });

  it("drops an equal seq and returns the same state object", () => {
    const first = applyAgentTodosSnapshot(initialAgentTodosState, makeSnapshot({ seq: 5 }));
    const second = applyAgentTodosSnapshot(
      first,
      makeSnapshot({ seq: 5, tasks: [{ id: 9, subject: "new", status: "pending" }] }),
    );
    expect(second).toBe(first);
    expect(snapshotFor(second, "agent-1")?.tasks).toEqual([]);
  });

  it("applies a strictly higher seq and replaces the stored snapshot", () => {
    const first = applyAgentTodosSnapshot(initialAgentTodosState, makeSnapshot({ seq: 5 }));
    const second = applyAgentTodosSnapshot(first, makeSnapshot({ seq: 6, tasks: [] }));
    expect(second).not.toBe(first);
    expect(snapshotFor(second, "agent-1")?.seq).toBe(6);
  });

  it("after reset, a seq-1 snapshot replaces a previously-stored seq-7 snapshot", () => {
    const before = applyAgentTodosSnapshot(initialAgentTodosState, makeSnapshot({ seq: 7 }));
    const reset = resetAgentTodosSeq(before);
    // The old snapshot's tasks/data are kept across reset (not dropped), just the tracked seq.
    expect(snapshotFor(reset, "agent-1")).toBeDefined();

    const after = applyAgentTodosSnapshot(
      reset,
      makeSnapshot({ seq: 1, tasks: [{ id: 2, subject: "restarted", status: "pending" }] }),
    );
    expect(snapshotFor(after, "agent-1")?.seq).toBe(1);
    expect(snapshotFor(after, "agent-1")?.tasks).toEqual([
      { id: 2, subject: "restarted", status: "pending" },
    ]);
  });

  it("without reset, a lower seq after a restart would still be dropped (reset is required)", () => {
    const before = applyAgentTodosSnapshot(initialAgentTodosState, makeSnapshot({ seq: 7 }));
    const after = applyAgentTodosSnapshot(before, makeSnapshot({ seq: 1 }));
    expect(snapshotFor(after, "agent-1")?.seq).toBe(7);
  });

  it("agents are tracked independently", () => {
    let state: AgentTodosState = initialAgentTodosState;
    state = applyAgentTodosSnapshot(state, makeSnapshot({ agentId: "agent-1", seq: 3 }));
    state = applyAgentTodosSnapshot(state, makeSnapshot({ agentId: "agent-2", seq: 1 }));
    // A stale seq for agent-1 is dropped; agent-2's own seq-1 is its first snapshot and applies.
    state = applyAgentTodosSnapshot(state, makeSnapshot({ agentId: "agent-1", seq: 2 }));

    expect(snapshotFor(state, "agent-1")?.seq).toBe(3);
    expect(snapshotFor(state, "agent-2")?.seq).toBe(1);
  });

  it("snapshotFor returns undefined for an agent with no snapshot", () => {
    expect(snapshotFor(initialAgentTodosState, "unknown")).toBeUndefined();
  });
});
