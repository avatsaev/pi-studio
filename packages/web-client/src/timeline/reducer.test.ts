import { describe, expect, it } from "vitest";
import { applyStreamEvent, EMPTY_TIMELINE } from "./reducer.js";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";

/**
 * Tool-call detail is split across Pi events: command/path arrive on the "running"
 * (`tool_execution_start`) event, while the edit diff arrives only on the "completed"
 * (`tool_execution_end`) event, which carries no args. The reducer must merge these into one row
 * keyed by callId rather than let the detail-less completed event blank the running detail.
 */
function toolCall(
  callId: string,
  tool: Extract<AgentStreamEvent, { kind: "tool_call" }>["tool"],
  status: string,
): AgentStreamEvent {
  return { kind: "tool_call", callId, tool, status };
}

describe("timeline reducer — tool-call detail merge", () => {
  it("keeps the running command when the completed event carries no args", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, toolCall("c1", { kind: "shell", command: "echo hi" }, "running"));
    s = applyStreamEvent(s, toolCall("c1", { kind: "shell" }, "completed"));

    expect(s.rows).toHaveLength(1);
    const row = s.rows[0];
    expect(row?.kind).toBe("tool");
    if (row?.kind !== "tool") throw new Error("expected tool row");
    expect(row.status).toBe("completed");
    expect(row.tool).toEqual({ kind: "shell", command: "echo hi" });
  });

  it("merges the start path with the end diff into a single edit row", () => {
    const patch = "--- demo.txt\n+++ demo.txt\n@@ -1,3 +1,3 @@\n line1\n-CHANGED\n+CHANGED3\n line3\n";
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, toolCall("c2", { kind: "edit", path: "demo.txt" }, "running"));
    s = applyStreamEvent(s, toolCall("c2", { kind: "edit", diff: patch }, "completed"));

    expect(s.rows).toHaveLength(1);
    const row = s.rows[0];
    if (row?.kind !== "tool") throw new Error("expected tool row");
    expect(row.tool).toEqual({ kind: "edit", path: "demo.txt", diff: patch });
    expect(row.status).toBe("completed");
  });
});
