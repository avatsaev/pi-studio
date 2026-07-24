import { describe, expect, it } from "vitest";
import { addOptimisticUserMessage, applyStreamEvent, markUserMessageFailed, EMPTY_TIMELINE } from "./reducer.js";
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

describe("timeline reducer — optimistic user-message echo", () => {
  it("reconciles the pending optimistic row in place instead of appending a duplicate", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-1", "hello");
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ kind: "user", text: "hello", pending: true, clientMessageId: "cm-1" });

    s = applyStreamEvent(s, { kind: "user_message", messageId: "cm-1", text: "hello" });

    expect(s.rows).toHaveLength(1); // still one row — reconciled, not duplicated
    expect(s.rows[0]).toMatchObject({ kind: "user", text: "hello", pending: false, clientMessageId: "cm-1" });
  });

  it("appends a fresh confirmed row when no pending optimistic row matches (session-restore replay)", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "user_message", messageId: "cm-2", text: "restored" });

    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ kind: "user", text: "restored" });
    expect((s.rows[0] as { pending?: boolean }).pending).toBeFalsy();
  });

  it("appends a fresh confirmed row when the event carries no messageId at all", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "user_message", text: "no id" });

    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ kind: "user", text: "no id" });
  });

  it("marks a still-pending row as failed on RPC rejection", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-3", "will fail");
    s = markUserMessageFailed(s, "cm-3");

    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ kind: "user", pending: false, failed: true });
  });

  it("does not clobber an already-reconciled row if the RPC promise rejects afterward", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-4", "confirmed first");
    s = applyStreamEvent(s, { kind: "user_message", messageId: "cm-4", text: "confirmed first" });
    s = markUserMessageFailed(s, "cm-4"); // late RPC rejection, after the broadcast already confirmed it

    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ kind: "user", pending: false });
    expect((s.rows[0] as { failed?: boolean }).failed).toBeFalsy();
  });

  it("is a no-op when markUserMessageFailed targets an unknown clientMessageId", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-5", "hi");
    const before = s;
    s = markUserMessageFailed(s, "cm-does-not-exist");

    expect(s).toBe(before); // pure no-op — same reference, no cloning
  });
});

describe("timeline reducer — steering (queued flag + queue_update)", () => {
  it("marks a steered optimistic row queued, and onUserMessage reconciliation preserves it", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-steer-1", "focus on tests", undefined, true);
    expect(s.rows[0]).toMatchObject({ kind: "user", pending: true, queued: true });

    s = applyStreamEvent(s, { kind: "user_message", messageId: "cm-steer-1", text: "focus on tests" });

    expect(s.rows).toHaveLength(1); // reconciled, not duplicated
    expect(s.rows[0]).toMatchObject({ kind: "user", pending: false, queued: true });
  });

  it("a normal (non-steered) optimistic row is never queued", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-send-1", "hello");
    const row = s.rows[0];
    if (row?.kind !== "user") throw new Error("expected user row");
    expect(row.queued).toBeFalsy();
  });

  it("queue_update clears queued once the text drops out of steering[]", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-steer-2", "actually, focus on tests", undefined, true);
    s = applyStreamEvent(s, { kind: "queue_update", steering: ["actually, focus on tests"] });

    expect(s.rows[0]).toMatchObject({ queued: true }); // still queued — text is still pending delivery

    s = applyStreamEvent(s, { kind: "queue_update", steering: [] });

    expect(s.rows[0]).toMatchObject({ queued: false }); // delivered — text no longer listed
  });

  it("queue_update never touches an unqueued row even if its text matches followUp[]", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-send-2", "hello");
    const before = s;
    s = applyStreamEvent(s, { kind: "queue_update", steering: [], followUp: ["hello"] });

    expect(s).toBe(before); // pure no-op — same reference, no cloning
  });

  it("is a pure no-op when queue_update has nothing to clear", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "queue_update", steering: ["unrelated"] });
    expect(s.rows).toHaveLength(0);
  });
});
