import { describe, expect, it } from "vitest";

import {
  isTodoDetails,
  replayTodosFromBranch,
  todoDetailsFromFrame,
  toAgentTodos,
  TODO_STATE_ENTRY_TYPE,
} from "./todos.js";

/**
 * Fixtures are the frames and entries recorded against real Pi 1.4.0 + `@juicesharp/rpiv-todo@2.15.0`
 * (sprint-079/task-001 summary), with the harness's own task text.
 */
const created = {
  action: "create",
  params: {
    action: "create",
    tasks: [{ subject: "Alpha" }, { subject: "Beta" }, { subject: "Gamma" }],
  },
  tasks: [
    { id: 1, subject: "Alpha", status: "pending" },
    { id: 2, subject: "Beta", status: "pending" },
    { id: 3, subject: "Gamma", status: "pending" },
  ],
  nextId: 4,
};
const started = {
  action: "update",
  params: { action: "update", id: 1, status: "in_progress", activeForm: "doing alpha" },
  tasks: [
    { id: 1, subject: "Alpha", status: "in_progress", activeForm: "doing alpha" },
    { id: 2, subject: "Beta", status: "pending" },
    { id: 3, subject: "Gamma", status: "pending" },
  ],
  nextId: 4,
};
/** `isError` is false for a failed call: `details.error` is set and the list is unchanged. */
const failed = {
  ...started,
  action: "update",
  params: { action: "update", id: 999, status: "completed" },
  error: "#999 not found",
};

const stateEntry = (data: unknown) => ({ type: "custom", customType: TODO_STATE_ENTRY_TYPE, data });
const toolResult = (details: unknown, toolName = "todo") => ({
  type: "message",
  message: { role: "toolResult", toolName, details, isError: false },
});
const toolEnd = (details: unknown, extra: Record<string, unknown> = {}) => ({
  type: "tool_execution_end",
  toolCallId: "toolu_1",
  toolName: "todo",
  result: { content: [{ type: "text", text: "ok" }], details },
  isError: false,
  ...extra,
});

describe("isTodoDetails", () => {
  it("accepts the recorded create, update and error envelopes", () => {
    expect(isTodoDetails(created)).toBe(true);
    expect(isTodoDetails(started)).toBe(true);
    expect(isTodoDetails(failed)).toBe(true);
  });

  it("accepts every optional field with the right type, including tombstones", () => {
    expect(
      isTodoDetails({
        tasks: [
          {
            id: 7,
            subject: "s",
            status: "deleted",
            description: "d",
            activeForm: "a",
            owner: "o",
            blockedBy: [1, 2],
            metadata: { k: 1 },
          },
        ],
        nextId: 8,
      }),
    ).toBe(true);
  });

  it("rejects the whole snapshot when any single task is malformed", () => {
    const bad = [
      { id: 1.5, subject: "s", status: "pending" },
      { id: 1, subject: 2, status: "pending" },
      { id: 1, subject: "s", status: "blocked" },
      { id: 1, subject: "s", status: "pending", blockedBy: ["1"] },
      { id: 1, subject: "s", status: "pending", metadata: "x" },
      { id: 1, subject: "s", status: "pending", owner: 3 },
      null,
    ];
    for (const task of bad) {
      expect(isTodoDetails({ tasks: [created.tasks[0], task], nextId: 4 })).toBe(false);
    }
  });

  it("rejects a missing or non-integer nextId, a non-array tasks and non-objects", () => {
    expect(isTodoDetails({ tasks: [] })).toBe(false);
    expect(isTodoDetails({ tasks: [], nextId: 1.5 })).toBe(false);
    expect(isTodoDetails({ tasks: "truncated…", nextId: 1 })).toBe(false);
    expect(isTodoDetails(null)).toBe(false);
    expect(isTodoDetails("todo")).toBe(false);
  });
});

describe("toAgentTodos", () => {
  it("drops tombstones, metadata and nextId, and sorts by id", () => {
    const list = toAgentTodos({
      nextId: 9,
      tasks: [
        { id: 3, subject: "c", status: "completed", metadata: { secret: true } },
        { id: 1, subject: "a", status: "deleted" },
        { id: 2, subject: "b", status: "in_progress", activeForm: "doing b", blockedBy: [3] },
      ],
    });
    expect(list.truncated).toBe(false);
    expect(list.tasks).toEqual([
      { id: 2, subject: "b", status: "in_progress", activeForm: "doing b", blockedBy: [3] },
      { id: 3, subject: "c", status: "completed" },
    ]);
  });

  it("is an empty, untruncated list when every task is deleted", () => {
    expect(
      toAgentTodos({ nextId: 2, tasks: [{ id: 1, subject: "x", status: "deleted" }] }),
    ).toEqual({
      tasks: [],
      truncated: false,
    });
  });

  it("keeps duplicate ids in their original order", () => {
    const list = toAgentTodos({
      nextId: 3,
      tasks: [
        { id: 1, subject: "first", status: "pending" },
        { id: 1, subject: "second", status: "pending" },
      ],
    });
    expect(list.tasks.map((t) => t.subject)).toEqual(["first", "second"]);
  });

  it("caps 250 tasks at 200 and flags it, ending an over-long subject in an ellipsis", () => {
    const tasks = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      subject: i === 0 ? "x".repeat(900) : `t${i + 1}`,
      status: "pending" as const,
    }));
    const list = toAgentTodos({ nextId: 251, tasks });
    expect(list.tasks).toHaveLength(200);
    expect(list.truncated).toBe(true);
    expect(list.tasks[0]!.subject).toHaveLength(500);
    expect(list.tasks[0]!.subject.endsWith("…")).toBe(true);
  });
});

describe("replayTodosFromBranch", () => {
  it("replays a state entry that is newer than a toolResult", () => {
    const list = replayTodosFromBranch([
      toolResult(created),
      stateEntry(created),
      toolResult(started),
      stateEntry(started),
    ]);
    expect(list.tasks[0]).toMatchObject({
      id: 1,
      status: "in_progress",
      activeForm: "doing alpha",
    });
  });

  it("lets state entries beat a LATER toolResult, as the extension does", () => {
    const list = replayTodosFromBranch([stateEntry(started), toolResult(created)]);
    expect(list.tasks[0]).toMatchObject({ id: 1, status: "in_progress" });
  });

  it("replays a nested call that left only a state entry", () => {
    const list = replayTodosFromBranch([stateEntry(created), stateEntry(started)]);
    expect(list.tasks).toHaveLength(3);
    expect(list.tasks[0]!.status).toBe("in_progress");
  });

  it("falls back to the last valid toolResult for a session written before state entries", () => {
    const list = replayTodosFromBranch([
      toolResult(created),
      toolResult({ tasks: "garbage", nextId: 1 }),
      toolResult(started),
    ]);
    expect(list.tasks[0]).toMatchObject({ id: 1, status: "in_progress" });
  });

  it("ignores a foreign tool, other custom entries and an invalid state entry", () => {
    const list = replayTodosFromBranch([
      toolResult(created),
      toolResult(started, "not_todo"),
      { type: "custom", customType: "something-else", data: started },
      stateEntry({ tasks: [{ id: 1 }], nextId: 2 }),
      { type: "session_info", name: "x" },
    ]);
    expect(list.tasks.map((t) => t.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("is empty for an empty branch", () => {
    expect(replayTodosFromBranch([])).toEqual({ tasks: [], truncated: false });
  });
});

describe("todoDetailsFromFrame", () => {
  it("recognises a tool_execution_end for todo, including an error result", () => {
    expect(todoDetailsFromFrame(toolEnd(created))).toEqual(created);
    expect(todoDetailsFromFrame(toolEnd(failed))).toEqual(failed);
  });

  it("recognises an entry_appended state entry", () => {
    const frame = {
      type: "entry_appended",
      entry: { ...stateEntry(started), id: "e1", parentId: "e0" },
    };
    expect(todoDetailsFromFrame(frame)).toEqual(started);
  });

  it("accepts a nested call: parentToolCallId marks same-session work, never a child list", () => {
    const nested = toolEnd(started, {
      toolCallId: "toolu_1/2",
      parentToolCallId: "toolu_1",
    });
    expect(todoDetailsFromFrame(nested)).toEqual(started);
  });

  it("rejects other tools, other entry types, invalid data and non-frames", () => {
    expect(todoDetailsFromFrame({ ...toolEnd(created), toolName: "bash" })).toBeUndefined();
    expect(todoDetailsFromFrame(toolEnd({ tasks: [{ id: "1" }], nextId: 1 }))).toBeUndefined();
    expect(todoDetailsFromFrame(toolEnd(undefined))).toBeUndefined();
    expect(
      todoDetailsFromFrame({
        type: "entry_appended",
        entry: { type: "custom", customType: "other", data: created },
      }),
    ).toBeUndefined();
    expect(
      todoDetailsFromFrame({
        type: "entry_appended",
        entry: stateEntry({ tasks: [], nextId: "x" }),
      }),
    ).toBeUndefined();
    expect(
      todoDetailsFromFrame({ type: "tool_execution_start", toolName: "todo" }),
    ).toBeUndefined();
    expect(todoDetailsFromFrame(null)).toBeUndefined();
    expect(todoDetailsFromFrame("entry_appended")).toBeUndefined();
  });
});
