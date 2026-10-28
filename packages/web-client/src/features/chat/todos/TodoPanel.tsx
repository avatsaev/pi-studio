/**
 * TodoPanel — the agent's todo list above the composer (swe/features/agent-todos-ui.md). Read-only:
 * every decision (counts, summary, grouping, labels) is a pure function in `todo-panel-model.ts`;
 * this file is markup, local expand state and one scroll effect. All text is rendered as React text
 * nodes — never as HTML or markdown, so a subject like `<b>x</b>` stays literal.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, Circle } from "lucide-react";
import { AGENT_TODOS_MAX_TASKS, type AgentTodo } from "@av-pi-studio/protocol";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import {
  useAgentTodosSnapshot,
  useAgentTodosStore,
  useTodoPanelCollapsed,
} from "./agent-todos-store.js";
import {
  blockedByLabel,
  collapsedSummary,
  counts,
  inProgress,
  isExpandable,
  panelRows,
  rowText,
} from "./todo-panel-model.js";
import styles from "./TodoPanel.module.css";

export interface TodoPanelProps {
  agentId: string | null;
}

function StatusIcon({ status }: { status: AgentTodo["status"] }) {
  if (status === "in_progress") {
    return (
      <span className={`${styles.icon} ${styles.iconInProgress}`}>
        <Spinner size={14} aria-label="In progress" />
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className={`${styles.icon} ${styles.iconCompleted}`}>
        <Icon icon={Check} size="sm" aria-label="Completed" />
      </span>
    );
  }
  return (
    <span className={`${styles.icon} ${styles.iconPending}`}>
      <Icon icon={Circle} size="sm" aria-label="Pending" />
    </span>
  );
}

function TaskRow({ task }: { task: AgentTodo }) {
  const [open, setOpen] = useState(false);
  const blocked = blockedByLabel(task);
  const expandable = isExpandable(task);
  const content = (
    <>
      <StatusIcon status={task.status} />
      <span className={`${styles.text} ${task.status === "completed" ? styles.textCompleted : ""}`}>
        {rowText(task)}
      </span>
      {blocked && <span className={styles.blocked}>{blocked}</span>}
      <span className={styles.id}>#{task.id}</span>
      {expandable && (
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
          <Icon icon={ChevronRight} size="xs" aria-hidden />
        </span>
      )}
    </>
  );
  return (
    <li className={styles.row} data-status={task.status} data-task-id={task.id}>
      {expandable ? (
        <button
          type="button"
          className={styles.rowButton}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {content}
        </button>
      ) : (
        <div className={styles.rowStatic}>{content}</div>
      )}
      {open && (
        <p className={styles.details}>
          {task.description}
          {task.description && task.owner ? "\n" : ""}
          {task.owner ? `Owner: ${task.owner}` : ""}
        </p>
      )}
    </li>
  );
}

function CompletedGroup({ tasks }: { tasks: AgentTodo[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.rowButton}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`${styles.icon} ${styles.iconCompleted}`}>
          <Icon icon={Check} size="sm" aria-hidden />
        </span>
        <span className={styles.text}>{tasks.length} completed</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
          <Icon icon={ChevronRight} size="xs" aria-hidden />
        </span>
      </button>
      {open && (
        <ol className={styles.nested}>
          {tasks.map((task, index) => (
            <TaskRow key={`${task.id}-${index}`} task={task} />
          ))}
        </ol>
      )}
    </li>
  );
}

export function TodoPanel({ agentId }: TodoPanelProps) {
  const snapshot = useAgentTodosSnapshot(agentId);
  const collapsed = useTodoPanelCollapsed(agentId);
  const bodyId = useId();
  const bodyRef = useRef<HTMLOListElement>(null);

  // Track while mounted; a draft that binds an agent id starts tracking without a remount.
  useEffect(() => {
    if (!agentId) return;
    return useAgentTodosStore.getState().track(agentId);
  }, [agentId]);

  const tasks = snapshot?.tasks;
  const currentId = tasks ? inProgress(tasks)?.id : undefined;

  // Keep the active task visible INSIDE the panel only: set scrollTop, never scrollIntoView (which
  // would also scroll the timeline and the page).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || currentId === undefined || collapsed) return;
    const row = body.querySelector<HTMLElement>(
      `[data-task-id="${currentId}"][data-status="in_progress"]`,
    );
    if (!row) return;
    const top = row.offsetTop - body.offsetTop;
    if (top < body.scrollTop || top + row.offsetHeight > body.scrollTop + body.clientHeight) {
      body.scrollTop = top - (body.clientHeight - row.offsetHeight) / 2;
    }
  }, [currentId, collapsed]);

  if (!agentId || !snapshot || snapshot.tasks.length === 0) return null;

  const { done, total } = counts(snapshot.tasks);
  const summary = collapsed ? collapsedSummary(snapshot.tasks) : undefined;

  return (
    <section className={styles.panel} role="region" aria-label="Agent todos">
      <button
        type="button"
        className={styles.header}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={() => useAgentTodosStore.getState().setCollapsed(agentId, !collapsed)}
      >
        <span className={`${styles.chevron} ${collapsed ? "" : styles.chevronOpen}`}>
          <Icon icon={ChevronRight} size="sm" aria-hidden />
        </span>
        <span className={styles.label}>Todos</span>
        <span className={styles.count}>
          {done}/{total}
        </span>
        {summary && <span className={styles.summary}>{summary}</span>}
      </button>
      {!collapsed && (
        <ol id={bodyId} ref={bodyRef} className={styles.body}>
          {panelRows(snapshot.tasks).map((row) =>
            row.kind === "task" ? (
              <TaskRow key={row.key} task={row.task} />
            ) : (
              <CompletedGroup key={row.key} tasks={row.tasks} />
            ),
          )}
        </ol>
      )}
      {!collapsed && snapshot.truncated && (
        <div className={styles.footer}>Showing first {AGENT_TODOS_MAX_TASKS} tasks</div>
      )}
    </section>
  );
}
