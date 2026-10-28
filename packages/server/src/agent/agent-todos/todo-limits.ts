import {
  AGENT_TODO_MAX_ACTIVE_FORM_CHARS,
  AGENT_TODO_MAX_BLOCKED_BY,
  AGENT_TODO_MAX_DESCRIPTION_CHARS,
  AGENT_TODO_MAX_OWNER_CHARS,
  AGENT_TODO_MAX_SUBJECT_CHARS,
  AGENT_TODOS_MAX_TASKS,
  type AgentTodo,
} from "@av-pi-studio/protocol";

import type { AgentTodoList } from "../provider-contract.js";

/**
 * Provider-neutral limits for an agent's todo list (features/agent-todos.md § Limits). Every
 * provider that reports todos (the Pi adapter, the mock) runs its tasks through here so the wire
 * never carries more than the protocol's documented caps, whichever producer made them.
 */

const ELLIPSIS = "…";

/** Truncate to at most `max` UTF-16 units, ending in `…`, without splitting a surrogate pair. */
function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max - 1;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return value.slice(0, end) + ELLIPSIS;
}

function capTask(task: AgentTodo): AgentTodo {
  const capped: AgentTodo = {
    id: task.id,
    subject: capText(task.subject, AGENT_TODO_MAX_SUBJECT_CHARS),
    status: task.status,
  };
  if (task.activeForm !== undefined) {
    capped.activeForm = capText(task.activeForm, AGENT_TODO_MAX_ACTIVE_FORM_CHARS);
  }
  if (task.description !== undefined) {
    capped.description = capText(task.description, AGENT_TODO_MAX_DESCRIPTION_CHARS);
  }
  if (task.owner !== undefined) capped.owner = capText(task.owner, AGENT_TODO_MAX_OWNER_CHARS);
  if (task.blockedBy !== undefined) {
    capped.blockedBy = task.blockedBy.slice(0, AGENT_TODO_MAX_BLOCKED_BY);
  }
  return capped;
}

/**
 * Sort by id (stable: duplicate ids keep their input order), keep the first
 * `AGENT_TODOS_MAX_TASKS` and cap every text field and `blockedBy`. Over-long values are truncated
 * with `…`, never rejected. The input is not mutated; unknown fields are dropped.
 */
export function capAgentTodos(tasks: readonly AgentTodo[]): AgentTodoList {
  const sorted = tasks.toSorted((a, b) => a.id - b.id);
  const truncated = sorted.length > AGENT_TODOS_MAX_TASKS;
  return {
    tasks: (truncated ? sorted.slice(0, AGENT_TODOS_MAX_TASKS) : sorted).map(capTask),
    truncated,
  };
}
