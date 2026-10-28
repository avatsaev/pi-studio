import {
  AGENT_TODO_MAX_BLOCKED_BY,
  AGENT_TODO_MAX_DESCRIPTION_CHARS,
  AGENT_TODO_MAX_OWNER_CHARS,
  AGENT_TODOS_MAX_TASKS,
  type AgentTodo,
} from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import { capAgentTodos } from "./todo-limits.js";

const todo = (id: number, extra: Partial<AgentTodo> = {}): AgentTodo => ({
  id,
  subject: `task ${id}`,
  status: "pending",
  ...extra,
});

describe("capAgentTodos", () => {
  it("sorts by id and leaves a small list untouched and untruncated", () => {
    const input = [todo(3), todo(1), todo(2, { activeForm: "doing", owner: "me", blockedBy: [1] })];
    const list = capAgentTodos(input);
    expect(list.truncated).toBe(false);
    expect(list.tasks.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(list.tasks[1]).toEqual(todo(2, { activeForm: "doing", owner: "me", blockedBy: [1] }));
    expect(input.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("keeps exactly the cap without flagging, and flags one task over", () => {
    const at = capAgentTodos(Array.from({ length: AGENT_TODOS_MAX_TASKS }, (_, i) => todo(i + 1)));
    expect(at.tasks).toHaveLength(AGENT_TODOS_MAX_TASKS);
    expect(at.truncated).toBe(false);

    const over = capAgentTodos(
      Array.from({ length: AGENT_TODOS_MAX_TASKS + 1 }, (_, i) => todo(i + 1)),
    );
    expect(over.tasks).toHaveLength(AGENT_TODOS_MAX_TASKS);
    expect(over.tasks.at(-1)!.id).toBe(AGENT_TODOS_MAX_TASKS);
    expect(over.truncated).toBe(true);
  });

  it("keeps the lowest ids when the cap drops tasks, whatever the input order", () => {
    const input = Array.from({ length: 230 }, (_, i) => todo(230 - i));
    const list = capAgentTodos(input);
    expect(list.tasks[0]!.id).toBe(1);
    expect(list.tasks.at(-1)!.id).toBe(200);
  });

  it("truncates over-long text to the cap with an ellipsis and never rejects", () => {
    const list = capAgentTodos([
      todo(1, {
        subject: "s".repeat(900),
        activeForm: "a".repeat(900),
        owner: "o".repeat(300),
        description: "d".repeat(AGENT_TODO_MAX_DESCRIPTION_CHARS + 1),
      }),
    ]);
    const t = list.tasks[0]!;
    expect(t.subject).toHaveLength(500);
    expect(t.activeForm).toHaveLength(500);
    expect(t.owner).toHaveLength(AGENT_TODO_MAX_OWNER_CHARS);
    expect(t.description).toHaveLength(AGENT_TODO_MAX_DESCRIPTION_CHARS);
    for (const v of [t.subject, t.activeForm, t.owner, t.description])
      expect(v!.endsWith("…")).toBe(true);
  });

  it("leaves text at exactly the cap alone", () => {
    const subject = "s".repeat(500);
    expect(capAgentTodos([todo(1, { subject })]).tasks[0]!.subject).toBe(subject);
  });

  it("never splits a surrogate pair when truncating", () => {
    const subject = "😀".repeat(400);
    const out = capAgentTodos([todo(1, { subject })]).tasks[0]!.subject;
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1)).toBe("😀".repeat((out.length - 1) / 2));
  });

  it("caps blockedBy at 50 entries", () => {
    const blockedBy = Array.from({ length: 80 }, (_, i) => i + 1);
    const list = capAgentTodos([todo(1, { blockedBy })]);
    expect(list.tasks[0]!.blockedBy).toEqual(blockedBy.slice(0, AGENT_TODO_MAX_BLOCKED_BY));
  });

  it("drops unknown fields and keeps duplicate ids in input order", () => {
    const list = capAgentTodos([
      { ...todo(1, { subject: "first" }), nextId: 9 } as AgentTodo,
      todo(1, { subject: "second" }),
    ]);
    expect(list.tasks.map((t) => t.subject)).toEqual(["first", "second"]);
    expect(list.tasks[0]).not.toHaveProperty("nextId");
  });
});
