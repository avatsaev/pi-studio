// Tool-call clustering: group consecutive tool_call rows into a collapsible
// cluster with a summary line ("5 tool calls: 2 edits, 1 read, 2 shell").
//
// clean-room-scope/features/timeline-rendering.md § Tool-call cards (packing),
// task-002 § Tool call grouping

import type { TimelineRow } from "./reducer.js";
import type { ToolCallPayload, ToolDetailType } from "./tool-cards.js";

export interface ToolCluster {
  /** Stable id derived from the first row. */
  clusterId: string;
  /** The consecutive tool-call rows in this cluster. */
  rows: TimelineRow[];
  /** One-line human summary, e.g. "5 tool calls: 2 edits, 1 read, 2 shell". */
  summary: string;
  /** Whether any call in the cluster failed. */
  hasError: boolean;
}

/** Group a flat row list, collapsing runs of ≥2 adjacent tool_call rows. */
export function clusterToolCalls(rows: readonly TimelineRow[]): (TimelineRow | ToolCluster)[] {
  const out: (TimelineRow | ToolCluster)[] = [];
  let run: TimelineRow[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]!);
    } else {
      out.push(buildCluster(run));
    }
    run = [];
  };

  for (const row of rows) {
    if (row.kind === "tool_call") {
      run.push(row);
    } else {
      flush();
      out.push(row);
    }
  }
  flush();
  return out;
}

export function isToolCluster(item: TimelineRow | ToolCluster): item is ToolCluster {
  return (item as ToolCluster).clusterId !== undefined && Array.isArray((item as ToolCluster).rows);
}

function buildCluster(rows: TimelineRow[]): ToolCluster {
  return {
    clusterId: `cluster-${rows[0]!.rowId}`,
    rows,
    summary: summarizeCluster(rows),
    hasError: rows.some((r) => (r.payload as ToolCallPayload | undefined)?.status === "failed"),
  };
}

/** Build the "N tool calls: 2 edits, 1 read, 2 shell" summary. */
export function summarizeCluster(rows: readonly TimelineRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const payload = row.payload as ToolCallPayload | undefined;
    const type = detailTypeOf(payload);
    const noun = TYPE_NOUNS[type] ?? type;
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [noun, n] of counts) {
    parts.push(`${n} ${n === 1 ? noun : pluralize(noun)}`);
  }
  const total = rows.length;
  return `${total} tool call${total === 1 ? "" : "s"}: ${parts.join(", ")}`;
}

function detailTypeOf(payload: ToolCallPayload | undefined): ToolDetailType {
  return (payload?.detail?.type as ToolDetailType | undefined) ?? "unknown";
}

const TYPE_NOUNS: Record<string, string> = {
  edit: "edit",
  write: "write",
  read: "read",
  shell: "shell",
  search: "search",
  fetch: "fetch",
  sub_agent: "task",
  plan: "plan",
  worktree_setup: "worktree",
  plain_text: "action",
  unknown: "call",
};

function pluralize(noun: string): string {
  if (noun.endsWith("h") || noun.endsWith("s")) return `${noun}es`;
  return `${noun}s`;
}
