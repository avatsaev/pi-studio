import { describe, it, expect } from "vitest";
import { clusterToolCalls, isToolCluster, summarizeCluster, type ToolCluster } from "./tool-grouping.js";
import type { TimelineRow } from "./reducer.js";
import type { ToolCallPayload } from "./tool-cards.js";

function toolRow(id: string, seq: number, payload: Partial<ToolCallPayload>): TimelineRow {
  return {
    rowId: id,
    kind: "tool_call",
    seqStart: seq,
    seqEnd: seq,
    source: "live",
    epochId: "e",
    timestamp: seq,
    payload: { callId: id, name: "x", status: "completed", ...payload } as ToolCallPayload,
  };
}

function otherRow(id: string, seq: number, kind: TimelineRow["kind"] = "assistant_message"): TimelineRow {
  return { rowId: id, kind, seqStart: seq, seqEnd: seq, source: "live", epochId: "e", timestamp: seq, payload: {} };
}

describe("clusterToolCalls", () => {
  it("collapses a run of ≥2 adjacent tool calls into a cluster", () => {
    const rows = [
      otherRow("a", 0),
      toolRow("t1", 1, { detail: { type: "edit", filePath: "a.ts" } }),
      toolRow("t2", 2, { detail: { type: "edit", filePath: "b.ts" } }),
      toolRow("t3", 3, { detail: { type: "read", filePath: "c.ts" } }),
      toolRow("t4", 4, { detail: { type: "shell", command: "ls" } }),
      toolRow("t5", 5, { detail: { type: "shell", command: "pwd" } }),
      otherRow("z", 6),
    ];
    const out = clusterToolCalls(rows);
    expect(out).toHaveLength(3); // assistant, cluster, assistant
    const cluster = out[1] as ToolCluster;
    expect(isToolCluster(cluster)).toBe(true);
    expect(cluster.rows).toHaveLength(5);
    expect(cluster.summary).toBe("5 tool calls: 2 edits, 1 read, 2 shells");
  });

  it("leaves a lone tool call ungrouped", () => {
    const rows = [otherRow("a", 0), toolRow("t1", 1, { detail: { type: "read", filePath: "x" } }), otherRow("b", 2)];
    const out = clusterToolCalls(rows);
    expect(out).toHaveLength(3);
    expect(isToolCluster(out[1]!)).toBe(false);
  });

  it("flags an error cluster when any call failed", () => {
    const rows = [
      toolRow("t1", 1, { detail: { type: "shell", command: "a" } }),
      toolRow("t2", 2, { status: "failed", detail: { type: "shell", command: "b" }, error: "boom" }),
    ];
    const cluster = clusterToolCalls(rows)[0] as ToolCluster;
    expect(cluster.hasError).toBe(true);
  });
});

describe("summarizeCluster", () => {
  it("pluralizes correctly and totals calls", () => {
    const rows = [
      toolRow("t1", 1, { detail: { type: "search", query: "x" } }),
      toolRow("t2", 2, { detail: { type: "search", query: "y" } }),
      toolRow("t3", 3, { detail: { type: "fetch", url: "u" } }),
    ];
    expect(summarizeCluster(rows)).toBe("3 tool calls: 2 searches, 1 fetch");
  });
});
