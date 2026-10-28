import { describe, expect, it } from "vitest";

import {
  advanceTodos,
  blockedTodos,
  clearTodos,
  doneTodos,
  getTodoScriptHelpText,
  hugeTodos,
  literalTodos,
  manyTodos,
  parseTodoScript,
  planTodos,
  TODO_SCRIPT_RECIPES,
} from "./todo-script.js";

describe("parseTodoScript", () => {
  it("returns null for an ordinary prompt", () => {
    expect(parseTodoScript("what's the weather like")).toBeNull();
  });

  it("returns null for a prompt that merely mentions #todo later in the text", () => {
    expect(parseTodoScript("please explain the #todo script grammar")).toBeNull();
  });

  it("returns 'help' for a bare #todo with nothing after it", () => {
    expect(parseTodoScript("#todo")).toBe("help");
    expect(parseTodoScript("#todo   ")).toBe("help");
  });

  it("returns 'help' for an unrecognised recipe", () => {
    expect(parseTodoScript("#todo banana")).toBe("help");
  });

  it("parses every documented recipe", () => {
    for (const recipe of TODO_SCRIPT_RECIPES) {
      expect(parseTodoScript(`#todo ${recipe}`)).toBe(recipe);
    }
  });

  it("is case-insensitive on the #todo sentinel only, not the recipe", () => {
    expect(parseTodoScript("#TODO plan")).toBe("plan");
    expect(parseTodoScript("#todo PLAN")).toBe("help"); // recipe itself is case-sensitive
  });
});

describe("getTodoScriptHelpText", () => {
  it("lists every recipe", () => {
    const text = getTodoScriptHelpText();
    for (const recipe of TODO_SCRIPT_RECIPES) {
      expect(text).toContain(`#todo ${recipe}`);
    }
  });
});

describe("planTodos", () => {
  it("returns 4 tasks, the first in_progress with an activeForm", () => {
    const tasks = planTodos();
    expect(tasks).toHaveLength(4);
    expect(tasks[0]!.status).toBe("in_progress");
    expect(tasks[0]!.activeForm).toBeTruthy();
    expect(tasks.slice(1).every((t) => t.status === "pending")).toBe(true);
  });
});

describe("advanceTodos", () => {
  it("completes the current in_progress task and starts the next pending one", () => {
    const next = advanceTodos(planTodos());
    expect(next[0]!.status).toBe("completed");
    expect(next[0]!.activeForm).toBeUndefined();
    expect(next[1]!.status).toBe("in_progress");
    expect(next[1]!.activeForm).toBeTruthy();
    expect(next[2]!.status).toBe("pending");
    expect(next[3]!.status).toBe("pending");
  });

  it("is idempotent-safe on an all-completed list (no in_progress, no pending)", () => {
    const done = doneTodos();
    expect(advanceTodos(done)).toEqual(done);
  });

  it("returns an empty list unchanged", () => {
    expect(advanceTodos([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const plan = planTodos();
    const snapshot = JSON.parse(JSON.stringify(plan));
    advanceTodos(plan);
    expect(plan).toEqual(snapshot);
  });
});

describe("doneTodos", () => {
  it("returns every task completed", () => {
    const tasks = doneTodos();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.status === "completed")).toBe(true);
  });
});

describe("manyTodos", () => {
  it("returns 12 tasks, 7 completed", () => {
    const tasks = manyTodos();
    expect(tasks).toHaveLength(12);
    expect(tasks.filter((t) => t.status === "completed")).toHaveLength(7);
  });
});

describe("blockedTodos", () => {
  it("includes blockedBy with a dangling id, plus description/owner", () => {
    const tasks = blockedTodos();
    const blocked = tasks.find((t) => t.blockedBy !== undefined);
    expect(blocked).toBeDefined();
    expect(blocked!.blockedBy!.some((id) => !tasks.some((t) => t.id === id))).toBe(true);
    expect(tasks.some((t) => t.description !== undefined)).toBe(true);
    expect(tasks.some((t) => t.owner !== undefined)).toBe(true);
  });
});

describe("literalTodos", () => {
  it("carries the literal markdown/HTML subject verbatim", () => {
    const tasks = literalTodos();
    expect(tasks[0]!.subject).toBe("**x** <b>y</b> [l](http://e)");
  });
});

describe("hugeTodos", () => {
  it("returns 250 tasks with over-cap fields", () => {
    const tasks = hugeTodos();
    expect(tasks).toHaveLength(250);
    expect(tasks[0]!.subject.length).toBeGreaterThan(500);
    expect(tasks[0]!.activeForm!.length).toBeGreaterThan(500);
    expect(tasks[0]!.description!.length).toBeGreaterThan(4000);
    expect(tasks[0]!.owner!.length).toBeGreaterThan(100);
    expect(tasks[0]!.blockedBy!.length).toBeGreaterThan(50);
  });
});

describe("clearTodos", () => {
  it("returns an empty list", () => {
    expect(clearTodos()).toEqual([]);
  });
});
