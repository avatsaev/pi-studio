import type { AgentTodo } from "@av-pi-studio/protocol";

import { capAgentTodos } from "../../agent-todos/todo-limits.js";
import type { AgentTodoList } from "../../provider-contract.js";

/**
 * Recognition of the `rpiv-todo` extension's state for the Pi provider (features/agent-todos.md
 * § Pi adapter: recognition). The agent's todo list is not exposed by Pi itself: the extension
 * (`@juicesharp/rpiv-todo`) keeps it in module state and renders it through a factory `setWidget`
 * that Pi never forwards over RPC. So the adapter re-derives it from the two places the
 * extension also leaves it — live, from the RPC stream; at rest, from Pi's session file.
 *
 * DELIBERATELY MIRRORS INTERNALS — NOT IMPORTABLE. None of this is public API of Pi or of the
 * extension, and the extension's package cannot be imported by the daemon. Mirrored from
 * `@juicesharp/rpiv-todo@2.15.0` (verified live against Pi 1.4.0, sprint-079/task-001):
 *   - `tool/types.ts`: `TOOL_NAME = "todo"`, `STATE_ENTRY_TYPE = "rpiv-todo-state"`, the `Task` /
 *     `TaskDetails` shapes and the four statuses (`deleted` is a tombstone kept IN the list)
 *   - `state/replay.ts`: `isTask`, `isTaskDetails` ("skip whole" validation) and `replayFromBranch`
 *     (state entries beat `toolResult` details once any exists)
 * Re-check all of it when the curated pack's rpiv-todo version changes (the source is unpinned:
 * `extensions/curated-packs.ts`) and when Pi is bumped (`entry_appended` and `tool_execution_end`
 * frame shapes, `SessionManager.getBranch()` entries). Drift fails closed: a snapshot that no
 * longer validates is ignored and the last valid list stays, never a wrong one.
 */

export const TODO_TOOL_NAME = "todo";
export const TODO_STATE_ENTRY_TYPE = "rpiv-todo-state";

/** One task as rpiv-todo persists it (`metadata` is opaque extension data and never forwarded). */
interface TodoTask {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  description?: string;
  activeForm?: string;
  owner?: string;
  blockedBy?: number[];
  metadata?: Record<string, unknown>;
}

/** rpiv-todo's `TaskDetails` envelope (`action`/`params`/`error` are ignored here). */
export interface TodoDetails {
  tasks: TodoTask[];
  nextId: number;
}

const optional = (value: unknown, valid: (v: unknown) => boolean): boolean =>
  value === undefined || valid(value);
const isString = (v: unknown): boolean => typeof v === "string";

function isTodoTask(value: unknown): value is TodoTask {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(t.id) &&
    typeof t.subject === "string" &&
    (t.status === "pending" ||
      t.status === "in_progress" ||
      t.status === "completed" ||
      t.status === "deleted") &&
    optional(t.description, isString) &&
    optional(t.activeForm, isString) &&
    optional(t.owner, isString) &&
    optional(t.blockedBy, (v) => Array.isArray(v) && v.every((id) => Number.isSafeInteger(id))) &&
    optional(t.metadata, (v) => typeof v === "object" && v !== null)
  );
}

/**
 * Strict discriminator for a `{tasks, nextId}` envelope. If ANY task is malformed the whole
 * snapshot is rejected, exactly as the extension does: a foreign tool that happens to be named
 * `todo`, or a future schema, then shows no panel instead of a wrong one.
 */
export function isTodoDetails(value: unknown): value is TodoDetails {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.tasks) && v.tasks.every(isTodoTask) && Number.isSafeInteger(v.nextId);
}

/** Wire projection: drop tombstones, `metadata` and `nextId`, then sort and cap. */
export function toAgentTodos(details: TodoDetails): AgentTodoList {
  const tasks: AgentTodo[] = [];
  for (const task of details.tasks) {
    if (task.status === "deleted") continue;
    const todo: AgentTodo = { id: task.id, subject: task.subject, status: task.status };
    if (task.activeForm !== undefined) todo.activeForm = task.activeForm;
    if (task.description !== undefined) todo.description = task.description;
    if (task.owner !== undefined) todo.owner = task.owner;
    if (task.blockedBy !== undefined) todo.blockedBy = task.blockedBy;
    tasks.push(todo);
  }
  return capAgentTodos(tasks);
}

/**
 * The list on a session branch, in rpiv-todo's own precedence: walk chronologically and keep the
 * last valid snapshot from each source. `rpiv-todo-state` custom entries are written for EVERY
 * state-changing call (including nested `ctx.executeTool` calls that never land as a `toolResult`),
 * so once any exists they are authoritative; `toolResult` details serve sessions written before
 * state entries existed. An empty branch is an empty list.
 */
export function replayTodosFromBranch(entries: Iterable<unknown>): AgentTodoList {
  let fromEntries: TodoDetails | undefined;
  let fromResults: TodoDetails | undefined;
  for (const entry of entries) {
    const e = entry as {
      type?: string;
      customType?: string;
      data?: unknown;
      message?: { role?: string; toolName?: string; details?: unknown };
    };
    if (e.type === "custom") {
      if (e.customType === TODO_STATE_ENTRY_TYPE && isTodoDetails(e.data)) fromEntries = e.data;
      continue;
    }
    if (e.type !== "message") continue;
    const msg = e.message;
    if (msg?.role !== "toolResult" || msg.toolName !== TODO_TOOL_NAME) continue;
    if (isTodoDetails(msg.details)) fromResults = msg.details;
  }
  return toAgentTodos(fromEntries ?? fromResults ?? { tasks: [], nextId: 1 });
}

/**
 * Live recogniser over a raw Pi RPC frame. Pi 1.4.0 announces a `todo` change twice:
 * `entry_appended` (the extension's `rpiv-todo-state` entry; fires for every state change, however
 * the tool was reached) and then `tool_execution_end` (direct calls; also `list`/error calls with
 * unchanged state). Both carry the full list, so either is a complete snapshot; the service dedupes
 * the pair. `parentToolCallId` is deliberately NOT inspected: a nested call (`ctx.executeTool`, e.g.
 * Pi's `codemode`) runs in the SAME session and mutates the same list.
 */
export function todoDetailsFromFrame(frame: unknown): TodoDetails | undefined {
  if (!frame || typeof frame !== "object") return undefined;
  const f = frame as {
    type?: unknown;
    entry?: { type?: unknown; customType?: unknown; data?: unknown };
    toolName?: unknown;
    result?: { details?: unknown };
  };
  if (f.type === "entry_appended") {
    const entry = f.entry;
    if (entry?.type === "custom" && entry.customType === TODO_STATE_ENTRY_TYPE) {
      return isTodoDetails(entry.data) ? entry.data : undefined;
    }
    return undefined;
  }
  if (f.type === "tool_execution_end" && f.toolName === TODO_TOOL_NAME) {
    return isTodoDetails(f.result?.details) ? f.result.details : undefined;
  }
  return undefined;
}
