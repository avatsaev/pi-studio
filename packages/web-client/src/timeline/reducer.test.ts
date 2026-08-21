import { describe, expect, it } from "vitest";
import {
  addOptimisticUserMessage,
  applyStreamEvent,
  markUserMessageFailed,
  EMPTY_TIMELINE,
} from "./reducer.js";
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
    const patch =
      "--- demo.txt\n+++ demo.txt\n@@ -1,3 +1,3 @@\n line1\n-CHANGED\n+CHANGED3\n line3\n";
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

describe("timeline reducer — tool statusText passthrough", () => {
  it("carries an unrecognized wire status as statusText while normalizing status to running", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(
      s,
      toolCall("c3", { kind: "shell", command: "echo hi" }, "awaiting_approval"),
    );
    const row = s.rows[0];
    if (row?.kind !== "tool") throw new Error("expected tool row");
    expect(row.status).toBe("running");
    expect(row.statusText).toBe("awaiting_approval");
  });

  it("omits statusText when no event for the row has carried a wire status", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, {
      kind: "tool_call",
      callId: "c4",
      tool: { kind: "shell", command: "echo hi" },
    });
    const row = s.rows[0];
    if (row?.kind !== "tool") throw new Error("expected tool row");
    expect(row.statusText).toBeUndefined();
    expect(row.status).toBe("running");
  });

  it("sets statusText once a later event carries one, and overwrites it on the next status change", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, {
      kind: "tool_call",
      callId: "c5",
      tool: { kind: "shell", command: "echo hi" },
    });
    s = applyStreamEvent(s, toolCall("c5", { kind: "shell" }, "awaiting_approval"));
    let row = s.rows[0];
    if (row?.kind !== "tool") throw new Error("expected tool row");
    expect(row.statusText).toBe("awaiting_approval");

    s = applyStreamEvent(s, toolCall("c5", { kind: "shell" }, "completed"));
    row = s.rows[0];
    if (row?.kind !== "tool") throw new Error("expected tool row");
    expect(row.status).toBe("completed");
    expect(row.statusText).toBe("completed");
  });
});

/**
 * `streaming` is what `AssistantRow` reads to choose the live split render (`StreamingMarkdown`)
 * over one canonical `<Markdown>` parse. The reducer used to clear only the streaming *index* on
 * `tool_call`, leaving the row's flag set — so any message followed by a tool call kept a blinking
 * caret and an unhighlighted last block forever, including after reload (`use-session-restore`
 * replays through this same reducer).
 */
describe("timeline reducer — streaming finalization", () => {
  it("finalizes a mid-turn assistant row when a tool call follows it", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "turn_started" });
    s = applyStreamEvent(s, { kind: "assistant_message", text: "# Plan\n\nreading " });
    s = applyStreamEvent(s, { kind: "assistant_message", text: "the file." });
    expect(s.rows[0]).toMatchObject({ kind: "assistant", streaming: true });

    s = applyStreamEvent(s, toolCall("c1", { kind: "read", path: "a.ts" }, "running"));

    expect(s.rows[0]).toMatchObject({
      kind: "assistant",
      text: "# Plan\n\nreading the file.",
      streaming: false,
    });
  });

  it("finalizes on the `final` block-close marker, before any tool call arrives", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "assistant_message", text: "done" });
    s = applyStreamEvent(s, { kind: "assistant_message", final: true });

    expect(s.rows).toHaveLength(1); // the marker closes the row, it does not open a new one
    expect(s.rows[0]).toMatchObject({ kind: "assistant", text: "done", streaming: false });
    expect(s.streamingAssistantIndex).toBeNull();
  });

  it("never opens an empty row for a stray marker with nothing to close", () => {
    const s = applyStreamEvent(EMPTY_TIMELINE, { kind: "assistant_message", final: true });
    expect(s.rows).toHaveLength(0);
  });

  it("starts a new row for the next block after a finalized one", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "assistant_message", text: "first" });
    s = applyStreamEvent(s, { kind: "assistant_message", final: true });
    s = applyStreamEvent(s, { kind: "assistant_message", text: "second" });

    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ text: "first", streaming: false });
    expect(s.rows[1]).toMatchObject({ text: "second", streaming: true });
  });

  it("finalizes reasoning when assistant text follows, and vice versa", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "reasoning", text: "hmm" });
    s = applyStreamEvent(s, { kind: "assistant_message", text: "answer" });

    expect(s.rows[0]).toMatchObject({ kind: "reasoning", streaming: false });
    expect(s.rows[1]).toMatchObject({ kind: "assistant", streaming: true });

    s = applyStreamEvent(s, { kind: "reasoning", text: "more" });

    expect(s.rows[1]).toMatchObject({ kind: "assistant", streaming: false });
    expect(s.rows[2]).toMatchObject({ kind: "reasoning", streaming: true });
  });

  it("leaves no row streaming after a full multi-block turn", () => {
    const events: AgentStreamEvent[] = [
      { kind: "turn_started" },
      { kind: "assistant_message", text: "**plan**" },
      { kind: "assistant_message", final: true },
      toolCall("c1", { kind: "read", path: "a.ts" }, "running"),
      toolCall("c1", { kind: "read", path: "a.ts" }, "completed"),
      { kind: "assistant_message", text: "`done`" },
      { kind: "assistant_message", final: true },
      { kind: "turn_completed" },
    ];
    const s = events.reduce((state, event) => applyStreamEvent(state, event), EMPTY_TIMELINE);

    const stillStreaming = s.rows.filter((r) => "streaming" in r && r.streaming);
    expect(stillStreaming).toEqual([]);
  });

  it("still finalizes a trailing row when the provider emits no `final` marker", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "assistant_message", text: "no marker" });
    s = applyStreamEvent(s, { kind: "turn_completed" });

    expect(s.rows[0]).toMatchObject({ streaming: false });
  });

  it("does not finalize the streaming row on a steering user_message mid-block", () => {
    // Steering injects a user row while the assistant is still writing — splitting the row there
    // would tear one message into two bubbles.
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "assistant_message", text: "partial " });
    s = applyStreamEvent(s, { kind: "user_message", text: "actually, wait" });
    s = applyStreamEvent(s, { kind: "assistant_message", text: "continued" });

    expect(s.rows.filter((r) => r.kind === "assistant")).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ kind: "assistant", text: "partial continued" });
  });
});

describe("timeline reducer — row timestamp (meta-line display)", () => {
  it("stamps an assistant row's timestamp only on the chunk that creates it", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(
      s,
      { kind: "assistant_message", text: "hello " },
      "2026-08-17T13:00:00.000Z",
    );
    s = applyStreamEvent(
      s,
      { kind: "assistant_message", text: "world", final: true },
      "2026-08-17T13:00:05.000Z", // later chunk of the SAME row — must not move its timestamp
    );

    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      kind: "assistant",
      text: "hello world",
      timestamp: "2026-08-17T13:00:00.000Z",
    });
  });

  it("stamps a reasoning row's timestamp only on the chunk that creates it", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "reasoning", text: "thinking " }, "2026-08-17T13:00:00.000Z");
    s = applyStreamEvent(
      s,
      { kind: "reasoning", text: "more", final: true },
      "2026-08-17T13:00:05.000Z",
    );

    expect(s.rows[0]).toMatchObject({
      kind: "reasoning",
      timestamp: "2026-08-17T13:00:00.000Z",
    });
  });

  it("gives a fresh assistant row its own timestamp once the prior one finalizes", () => {
    let s = EMPTY_TIMELINE;
    s = applyStreamEvent(s, { kind: "assistant_message", text: "a", final: true }, "t1");
    s = applyStreamEvent(s, { kind: "assistant_message", text: "b" }, "t2");

    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ timestamp: "t1" });
    expect(s.rows[1]).toMatchObject({ timestamp: "t2" });
  });
});

describe("timeline reducer — optimistic user-message echo", () => {
  it("reconciles the pending optimistic row in place instead of appending a duplicate", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(s, "cm-1", "hello");
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({
      kind: "user",
      text: "hello",
      pending: true,
      clientMessageId: "cm-1",
    });

    s = applyStreamEvent(s, { kind: "user_message", messageId: "cm-1", text: "hello" });

    expect(s.rows).toHaveLength(1); // still one row — reconciled, not duplicated
    expect(s.rows[0]).toMatchObject({
      kind: "user",
      text: "hello",
      pending: false,
      clientMessageId: "cm-1",
    });
  });

  it("prefers the server's canonical timestamp over the optimistic echo's client-clock guess", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(
      s,
      "cm-ts",
      "hello",
      undefined,
      undefined,
      "2026-08-17T13:00:00.000Z",
    );
    expect(s.rows[0]).toMatchObject({ timestamp: "2026-08-17T13:00:00.000Z" });

    s = applyStreamEvent(
      s,
      { kind: "user_message", messageId: "cm-ts", text: "hello" },
      "2026-08-17T13:00:02.500Z", // arrives slightly later than the optimistic guess
    );

    expect(s.rows[0]).toMatchObject({ timestamp: "2026-08-17T13:00:02.500Z" });
  });

  it("keeps the optimistic echo's timestamp when the confirming event carries none", () => {
    let s = EMPTY_TIMELINE;
    s = addOptimisticUserMessage(
      s,
      "cm-ts-2",
      "hello",
      undefined,
      undefined,
      "2026-08-17T13:00:00.000Z",
    );
    s = applyStreamEvent(s, { kind: "user_message", messageId: "cm-ts-2", text: "hello" });
    expect(s.rows[0]).toMatchObject({ timestamp: "2026-08-17T13:00:00.000Z" });
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

    s = applyStreamEvent(s, {
      kind: "user_message",
      messageId: "cm-steer-1",
      text: "focus on tests",
    });

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

/**
 * Tool/error/system rows gained a `timestamp` for `ask-placement.ts`: without one, an extension
 * dialog cannot be placed relative to the tool call that raised it, and every card falls back to
 * trailing the transcript — the bug this field exists to fix.
 */
describe("timeline reducer — row timestamps", () => {
  const TS = "2026-08-21T13:30:00.000Z";

  it("stamps a tool row at the call's start", () => {
    const s = applyStreamEvent(EMPTY_TIMELINE, toolCall("c1", { kind: "shell" }, "running"), TS);
    expect(s.rows[0]).toMatchObject({ kind: "tool", timestamp: TS });
  });

  it("keeps the start timestamp when a later status update upserts the row", () => {
    let s = applyStreamEvent(EMPTY_TIMELINE, toolCall("c1", { kind: "shell" }, "running"), TS);
    s = applyStreamEvent(
      s,
      toolCall("c1", { kind: "shell" }, "completed"),
      "2026-08-21T13:31:00.000Z",
    );

    expect(s.rows).toHaveLength(1);
    // The row must not slide forward in time as the call progresses, or it would overtake any
    // dialog raised during the call.
    expect(s.rows[0]).toMatchObject({ kind: "tool", status: "completed", timestamp: TS });
  });

  it("stamps error rows from turn_failed and error events", () => {
    const failed = applyStreamEvent(EMPTY_TIMELINE, { kind: "turn_failed", error: "boom" }, TS);
    expect(failed.rows[0]).toMatchObject({ kind: "error", timestamp: TS });

    const errored = applyStreamEvent(EMPTY_TIMELINE, { kind: "error", message: "bad" }, TS);
    expect(errored.rows[0]).toMatchObject({ kind: "error", timestamp: TS });
  });

  it("stamps the canceled system row", () => {
    const s = applyStreamEvent(EMPTY_TIMELINE, { kind: "turn_canceled" }, TS);
    expect(s.rows[0]).toMatchObject({ kind: "system", timestamp: TS });
  });

  it("leaves the timestamp undefined when the event carries none", () => {
    const s = applyStreamEvent(EMPTY_TIMELINE, toolCall("c1", { kind: "shell" }, "running"));
    expect(s.rows[0]).toMatchObject({ kind: "tool" });
    expect((s.rows[0] as { timestamp?: string }).timestamp).toBeUndefined();
  });
});
