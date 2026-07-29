import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { hydrateTimelineFromSessionFile } from "./session-hydration.js";

function makeSessionManager(): SessionManager {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-hydration-"));
  return SessionManager.create("/work", dir);
}

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("hydrateTimelineFromSessionFile", () => {
  it("returns [] for a missing file (never throws)", () => {
    expect(hydrateTimelineFromSessionFile("/no/such/file.jsonl")).toEqual([]);
  });

  it("replays a simple user → assistant exchange as one turn", () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "hello", timestamp: 1000 });
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 2000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    expect(rows.map((r) => r.event.kind)).toEqual([
      "user_message",
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
    const userRow = rows[0];
    expect(userRow?.event.kind === "user_message" ? userRow.event.text : null).toBe("hello");
    const assistantRow = rows[2];
    expect(assistantRow?.event.kind === "assistant_message" ? assistantRow.event.text : null).toBe(
      "hi there",
    );
    // Real per-entry timestamps carried through, not a single "now" stamp.
    expect(rows[0]?.timestamp).toBe(new Date(1000).toISOString());
    expect(rows[2]?.timestamp).toBe(new Date(2000).toISOString());
  });

  it("carries a user message's attached images through rehydration (restart/resume regression)", () => {
    const sm = makeSessionManager();
    sm.appendMessage({
      role: "user",
      content: [
        { type: "text", text: "what is this?" },
        { type: "image", data: "Zm9v", mimeType: "image/png" },
      ],
      timestamp: 1000,
    });
    // The session file is only flushed once an assistant reply lands (SessionManager's
    // lazy-write optimization) — a bare user message never hits disk on its own.
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "a foo image" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 2000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    const userRow = rows[0];
    expect(userRow?.event.kind).toBe("user_message");
    expect(userRow?.event.kind === "user_message" ? userRow.event.text : null).toBe(
      "what is this?",
    );
    expect(userRow?.event.kind === "user_message" ? userRow.event.images : null).toEqual([
      { mimeType: "image/png", data: "Zm9v" },
    ]);
  });

  it("omits `images` (not `[]`) for a user message with no image blocks", () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "hello", timestamp: 1000 });
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 2000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    const userRow = rows[0];
    expect(
      userRow?.event.kind === "user_message" ? userRow.event.images : "missing",
    ).toBeUndefined();
  });

  it("replays tool calls with the edit diff and result output merged from the toolResult entry", () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "edit the file", timestamp: 1000 });
    sm.appendMessage({
      role: "assistant",
      content: [
        { type: "text", text: "sure" },
        { type: "toolCall", id: "call_1", name: "edit", arguments: { path: "/a.txt" } },
      ],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "toolUse",
      timestamp: 2000,
    });
    sm.appendMessage({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "edit",
      content: [{ type: "text", text: "ok" }],
      details: { patch: "+added line" },
      isError: false,
      timestamp: 3000,
    });
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 4000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    const toolRows = rows.filter((r) => r.event.kind === "tool_call");
    expect(toolRows).toHaveLength(2); // start (from toolCall block) + end (from toolResult)
    const start = toolRows[0];
    const end = toolRows[1];
    expect(start?.event.kind === "tool_call" ? start.event.status : null).toBe("running");
    expect(start?.event.kind === "tool_call" ? start.event.tool : null).toEqual({
      kind: "edit",
      path: "/a.txt",
      diff: undefined,
    });
    expect(end?.event.kind === "tool_call" ? end.event.status : null).toBe("completed");
    expect(end?.event.kind === "tool_call" ? end.event.tool : null).toEqual({
      kind: "edit",
      path: undefined,
      diff: "+added line",
      output: "ok",
    });
  });

  it("replays a bashExecution entry with command and output", () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "run ls", timestamp: 1000 });
    sm.appendMessage({
      role: "bashExecution",
      command: "ls -la",
      output: "total 0\ndrwxr-xr-x",
      exitCode: 0,
      timestamp: 2000,
    } as never);
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 3000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    const toolRow = rows.find((r) => r.event.kind === "tool_call");
    expect(toolRow?.event.kind === "tool_call" ? toolRow.event.status : null).toBe("completed");
    expect(toolRow?.event.kind === "tool_call" ? toolRow.event.tool : null).toEqual({
      kind: "shell",
      command: "ls -la",
      output: "total 0\ndrwxr-xr-x",
    });
  });

  it("marks a turn turn_failed when the assistant message's stopReason is error", () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "do something", timestamp: 1000 });
    sm.appendMessage({
      role: "assistant",
      content: [],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "error",
      errorMessage: "rate limited",
      timestamp: 2000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    const last = rows.at(-1);
    expect(last?.event.kind).toBe("turn_failed");
    expect(last?.event.kind === "turn_failed" ? last.event.error : null).toBe("rate limited");
  });

  it("gives each turn its own epoch and monotonically increasing seq across turns", () => {
    const sm = makeSessionManager();
    sm.appendMessage({ role: "user", content: "one", timestamp: 1000 });
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "a" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 2000,
    });
    sm.appendMessage({ role: "user", content: "two", timestamp: 3000 });
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "b" }],
      api: "x",
      provider: "p",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 4000,
    });

    const rows = hydrateTimelineFromSessionFile(sm.getSessionFile() as string);
    const epochs = rows.map((r) => r.epoch);
    expect(new Set(epochs).size).toBe(2);
    expect(epochs).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
