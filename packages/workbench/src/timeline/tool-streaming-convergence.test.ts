import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import { applyStreamEvent, EMPTY_TIMELINE } from "./reducer.js";

/**
 * Live/authoritative convergence for a streamed tool call (sprint-058/task-007). The frames below
 * are shaped exactly like the mock provider's `#tool` / `#tool empty` recipe (start running, 3
 * growing `partial: true` snapshots, completed end). A fetched timeline page holds only the start
 * and end rows (partials are never persisted), so the live replay must converge on the same row as
 * applying just those two events. Fixture duplicated from the server test on purpose: web-client
 * and server do not import each other.
 */

type ToolCallEvent = Extract<AgentStreamEvent, { kind: "tool_call" }>;

const CALL_ID = "call-1";
const COMMAND = "npm test";
const LINES = ["> running suite A", "> running suite B", "> running suite C"];

function frames(finalOutput: string): ToolCallEvent[] {
  const start: ToolCallEvent = {
    kind: "tool_call",
    callId: CALL_ID,
    status: "running",
    tool: { kind: "shell", command: COMMAND },
  };
  const partials: ToolCallEvent[] = [1, 2, 3].map((n) => ({
    kind: "tool_call",
    callId: CALL_ID,
    status: "running",
    partial: true,
    tool: { kind: "shell", command: COMMAND, output: LINES.slice(0, n).join("\n") },
  }));
  const end: ToolCallEvent = {
    kind: "tool_call",
    callId: CALL_ID,
    status: "completed",
    tool: { kind: "shell", command: COMMAND, output: finalOutput },
  };
  return [start, ...partials, end];
}

function replay(events: ToolCallEvent[]) {
  return events.reduce((s, e) => applyStreamEvent(s, e), EMPTY_TIMELINE);
}

function onlyToolRow(events: ToolCallEvent[]) {
  const rows = replay(events).rows.flatMap((r) => (r.kind === "tool" ? [r] : []));
  expect(rows).toHaveLength(1);
  // Row ids are a per-state counter (live took more events), not part of the converged content.
  const { id: _id, ...row } = rows[0]!;
  return row;
}

describe("streamed tool call: live replay converges on the fetched start + end rows", () => {
  it("non-empty final output", () => {
    const all = frames(`${LINES.join("\n")}\nall passed`);
    const live = onlyToolRow(all);
    const fetched = onlyToolRow([all[0]!, all[all.length - 1]!]);

    expect(live).toEqual(fetched);
    expect(live.status).toBe("completed");
    expect(live.tool).toEqual({
      kind: "shell",
      command: COMMAND,
      output: `${LINES.join("\n")}\nall passed`,
    });
  });

  it("empty final output clears the streamed partial output (terminal authority)", () => {
    const all = frames("");
    const live = onlyToolRow(all);
    const fetched = onlyToolRow([all[0]!, all[all.length - 1]!]);

    expect(live).toEqual(fetched);
    expect(live.status).toBe("completed");
    const output = live.tool && "output" in live.tool ? live.tool.output : undefined;
    expect(output ?? "").toBe("");
  });
});
