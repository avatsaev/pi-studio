import type { AgentTodo } from "@av-pi-studio/protocol";

/**
 * Scripted todo-list trigger for the mock provider (sprint-079/task-005). Lets a browser-connected
 * client drive every todo-panel state the web-client must render by typing a `#todo ...` prompt, so
 * the UI work in sprint-080 has reachable triggers for every state — grouped completed tasks,
 * blocked tasks, truncation, literal markdown, clearing — with no Pi and no model
 * (features/agent-todos.md § Provider contract, § Acceptance A11). Mirrors s068/t001's `#ui`
 * recipes (`ui-script.ts`): a pure, cheap-prefix-checked parser, a `help` recipe echoed verbatim by
 * `#todo help`, and recognised-but-unknown input falling back to help rather than an ordinary echo.
 *
 * `advance` is the one recipe whose RESULT depends on session state (the current list), so this
 * module keeps it pure too: `advanceTodos(current)` takes the session's current list as input and
 * returns the next one. `MockAgentSession` is the only caller that knows what "current" means.
 *
 * Grammar (also echoed verbatim by `#todo help`):
 *
 *   #todo plan      4 tasks, the first in_progress with an activeForm
 *   #todo advance   completes the current task, starts the next (relative to the session's list)
 *   #todo done      all tasks completed
 *   #todo many      12 tasks, 7 completed (exercises grouping and scroll)
 *   #todo blocked   blockedBy including a dangling id, plus description/owner
 *   #todo literal   a subject containing literal markdown/HTML, rendered verbatim
 *   #todo huge      250 tasks with over-cap fields (exercises the cap path)
 *   #todo clear     empty list
 *   #todo help      this list
 */

export const TODO_SCRIPT_RECIPES = [
  "plan",
  "advance",
  "done",
  "many",
  "blocked",
  "literal",
  "huge",
  "clear",
  "help",
] as const;

export type TodoScriptRecipe = (typeof TODO_SCRIPT_RECIPES)[number];

const RECIPE_SET: ReadonlySet<string> = new Set(TODO_SCRIPT_RECIPES);

const HELP_TEXT = `#todo script recipes:
  #todo plan                 4 tasks, the first in_progress with an activeForm
  #todo advance               completes the current task, starts the next
  #todo done                  all tasks completed
  #todo many                  12 tasks, 7 completed
  #todo blocked                blockedBy including a dangling id, plus description/owner
  #todo literal                 a subject containing literal markdown/HTML
  #todo huge                   250 tasks with over-cap fields
  #todo clear                  empty list
  #todo help                   this list`;

export function getTodoScriptHelpText(): string {
  return HELP_TEXT;
}

/** Parses a `#todo ...` prompt into the recipe it names. Returns `null` when `prompt` is not a
 *  recognised script — the overwhelmingly common case, kept a cheap prefix check. A `#todo` prompt
 *  whose recipe is empty or unrecognised still names a script (so the caller must show help, not
 *  run an ordinary echoed turn) — it returns `"help"`, never `null`, for those. */
export function parseTodoScript(prompt: string): TodoScriptRecipe | null {
  const trimmed = prompt.trim();
  if (!/^#todo(\s|$)/i.test(trimmed)) return null;

  const rest = trimmed.slice("#todo".length).trim();
  if (rest === "") return "help";
  return RECIPE_SET.has(rest) ? (rest as TodoScriptRecipe) : "help";
}

const PLAN_SUBJECTS = ["Design the schema", "Implement the service", "Wire the SDK", "Write tests"];

/** `#todo plan`: 4 tasks, the first `in_progress` with an `activeForm`. */
export function planTodos(): AgentTodo[] {
  return PLAN_SUBJECTS.map((subject, i) =>
    i === 0
      ? { id: i + 1, subject, status: "in_progress", activeForm: "Designing the schema" }
      : { id: i + 1, subject, status: "pending" },
  );
}

/** `#todo advance`: completes the session's current `in_progress` task (if any) and starts the
 *  next `pending` one (if any), relative to `current` — never reads global state. A list with no
 *  `in_progress` and no `pending` task (e.g. `done`, or the empty list before `plan`) is returned
 *  unchanged. */
export function advanceTodos(current: readonly AgentTodo[]): AgentTodo[] {
  const next = current.map((task) => ({ ...task }));

  const activeIndex = next.findIndex((task) => task.status === "in_progress");
  if (activeIndex !== -1) {
    const { activeForm: _activeForm, ...rest } = next[activeIndex]!;
    next[activeIndex] = { ...rest, status: "completed" };
  }

  const pendingIndex = next.findIndex((task) => task.status === "pending");
  if (pendingIndex !== -1) {
    const task = next[pendingIndex]!;
    next[pendingIndex] = {
      ...task,
      status: "in_progress",
      activeForm: task.activeForm ?? `Working on ${task.subject.toLowerCase()}`,
    };
  }

  return next;
}

/** `#todo done`: all tasks completed. */
export function doneTodos(): AgentTodo[] {
  return PLAN_SUBJECTS.map((subject, i) => ({ id: i + 1, subject, status: "completed" }));
}

/** `#todo many`: 12 tasks, 7 completed — exercises grouping and scroll. */
export function manyTodos(): AgentTodo[] {
  return Array.from({ length: 12 }, (_, i) => {
    const id = i + 1;
    if (i < 7) return { id, subject: `Completed task ${id}`, status: "completed" as const };
    if (i === 7) {
      return {
        id,
        subject: `Current task ${id}`,
        status: "in_progress" as const,
        activeForm: `Working on current task ${id}`,
      };
    }
    return { id, subject: `Pending task ${id}`, status: "pending" as const };
  });
}

/** `#todo blocked`: `blockedBy` (including a dangling id), plus `description`/`owner`. */
export function blockedTodos(): AgentTodo[] {
  return [
    {
      id: 1,
      subject: "Provision the staging database",
      status: "completed",
      description: "One-time setup; later tasks depend on its connection string.",
      owner: "infra",
    },
    {
      id: 2,
      subject: "Migrate the schema",
      status: "pending",
      description: "Waiting on review of the migration plan.",
      owner: "backend",
      blockedBy: [1, 99],
    },
    {
      id: 3,
      subject: "Backfill historical rows",
      status: "pending",
      description: "Depends on the migration landing first.",
      blockedBy: [2],
    },
  ];
}

const LITERAL_SUBJECT = "**x** <b>y</b> [l](http://e)";

/** `#todo literal`: subject containing literal markdown/HTML, rendered verbatim (never parsed). */
export function literalTodos(): AgentTodo[] {
  return [{ id: 1, subject: LITERAL_SUBJECT, status: "in_progress", activeForm: LITERAL_SUBJECT }];
}

/** `#todo huge`: 250 tasks (over `AGENT_TODOS_MAX_TASKS`) with over-cap text fields and an
 *  over-cap `blockedBy`, so `capAgentTodos` truncates the list AND every field. */
export function hugeTodos(): AgentTodo[] {
  const longSubject = "x".repeat(600);
  const longActiveForm = "y".repeat(600);
  const longDescription = "z".repeat(4100);
  const longOwner = "o".repeat(150);
  const manyBlockers = Array.from({ length: 60 }, (_, i) => i + 1000);
  return Array.from({ length: 250 }, (_, i) => ({
    id: i + 1,
    subject: longSubject,
    status: "pending" as const,
    activeForm: longActiveForm,
    description: longDescription,
    owner: longOwner,
    blockedBy: manyBlockers,
  }));
}

/** `#todo clear`: empty list. */
export function clearTodos(): AgentTodo[] {
  return [];
}
