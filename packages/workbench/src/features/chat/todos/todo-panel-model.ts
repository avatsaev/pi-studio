import type { AgentTodo } from "@av-pi-studio/protocol";

/**
 * Pure decisions for the agent todo panel (swe/features/agent-todos-ui.md). No React, no I/O:
 * web-client has no jsdom, so every branch lives here and is tested under Node.
 */

export type TodoPanelRow =
  | { kind: "task"; task: AgentTodo; key: string }
  | { kind: "completed-group"; count: number; tasks: AgentTodo[]; key: string };

/** More completed tasks than this collapse into one group row. */
export const COMPLETED_GROUP_THRESHOLD = 5;

/** Defensive order guarantee: stable sort by id (the wire already sends id order, no tombstones). */
export function visibleTasks(tasks: readonly AgentTodo[]): AgentTodo[] {
  return tasks.toSorted((a, b) => a.id - b.id);
}

export function counts(tasks: readonly AgentTodo[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === "completed").length, total: tasks.length };
}

/** The first `in_progress` task by id. */
export function inProgress(tasks: readonly AgentTodo[]): AgentTodo | undefined {
  return visibleTasks(tasks).find((t) => t.status === "in_progress");
}

/** `activeForm` while in progress (when present), otherwise the subject. */
export function rowText(task: AgentTodo): string {
  return task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
}

export function collapsedSummary(tasks: readonly AgentTodo[]): string | undefined {
  const current = inProgress(tasks);
  return current ? rowText(current) : undefined;
}

/** `blocked by #2, #5`; ids absent from the list still print. Never shown for completed tasks. */
export function blockedByLabel(task: AgentTodo): string | undefined {
  if (task.status === "completed" || !task.blockedBy?.length) return undefined;
  return `blocked by ${task.blockedBy.map((id) => `#${id}`).join(", ")}`;
}

export function isExpandable(task: AgentTodo): boolean {
  return Boolean(task.description) || Boolean(task.owner);
}

/**
 * Ordered render list. When more than `threshold` tasks are completed they collapse into one group
 * at the first completed task's position. Keys use `(id, index)`, so duplicate ids never collide.
 */
export function panelRows(
  tasks: readonly AgentTodo[],
  threshold: number = COMPLETED_GROUP_THRESHOLD,
): TodoPanelRow[] {
  const ordered = visibleTasks(tasks);
  const completed = ordered.filter((t) => t.status === "completed");
  const group = completed.length > threshold;
  const rows: TodoPanelRow[] = [];
  let grouped = false;
  ordered.forEach((task, index) => {
    if (group && task.status === "completed") {
      if (!grouped) {
        grouped = true;
        rows.push({
          kind: "completed-group",
          count: completed.length,
          tasks: completed,
          key: `group-${task.id}-${index}`,
        });
      }
      return;
    }
    rows.push({ kind: "task", task, key: `${task.id}-${index}` });
  });
  return rows;
}
