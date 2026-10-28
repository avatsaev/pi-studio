import type { AgentTodo } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import {
  blockedByLabel,
  collapsedSummary,
  counts,
  inProgress,
  isExpandable,
  panelRows,
  rowText,
  visibleTasks,
} from "./todo-panel-model.js";

const t = (id: number, status: AgentTodo["status"], extra: Partial<AgentTodo> = {}): AgentTodo => ({
  id,
  subject: `task ${id}`,
  status,
  ...extra,
});

describe("todo panel model", () => {
  it("counts completed against total", () => {
    expect(counts([t(1, "completed"), t(2, "pending"), t(3, "in_progress")])).toEqual({
      done: 1,
      total: 3,
    });
    expect(counts([])).toEqual({ done: 0, total: 0 });
  });

  it("picks the first in-progress task by id, or none", () => {
    expect(inProgress([t(3, "in_progress"), t(2, "in_progress")])?.id).toBe(2);
    expect(inProgress([t(1, "pending"), t(2, "completed")])).toBeUndefined();
    expect(collapsedSummary([t(1, "pending")])).toBeUndefined();
  });

  it("shows activeForm only while in progress", () => {
    expect(rowText(t(1, "in_progress", { activeForm: "running" }))).toBe("running");
    expect(rowText(t(1, "in_progress"))).toBe("task 1");
    expect(rowText(t(1, "pending", { activeForm: "running" }))).toBe("task 1");
    expect(
      collapsedSummary([t(1, "pending"), t(2, "in_progress", { activeForm: "doing 2" })]),
    ).toBe("doing 2");
  });

  it("labels blocked tasks, including dangling ids, but never completed ones", () => {
    expect(blockedByLabel(t(1, "pending", { blockedBy: [2, 9] }))).toBe("blocked by #2, #9");
    expect(blockedByLabel(t(1, "completed", { blockedBy: [2] }))).toBeUndefined();
    expect(blockedByLabel(t(1, "pending", { blockedBy: [] }))).toBeUndefined();
    expect(blockedByLabel(t(1, "pending"))).toBeUndefined();
  });

  it("expands only with a description or owner", () => {
    expect(isExpandable(t(1, "pending", { description: "d" }))).toBe(true);
    expect(isExpandable(t(1, "pending", { owner: "o" }))).toBe(true);
    expect(isExpandable(t(1, "pending", { description: "" }))).toBe(false);
  });

  it("sorts defensively and stably", () => {
    expect(visibleTasks([t(2, "pending"), t(1, "pending")]).map((x) => x.id)).toEqual([1, 2]);
    const dup = visibleTasks([
      t(1, "pending", { subject: "a" }),
      t(1, "pending", { subject: "b" }),
    ]);
    expect(dup.map((x) => x.subject)).toEqual(["a", "b"]);
  });

  it("does not group exactly 5 completed tasks, groups 6 at the first completed position", () => {
    const five = [1, 2, 3, 4, 5].map((i) => t(i, "completed"));
    expect(panelRows([...five, t(6, "pending")]).every((r) => r.kind === "task")).toBe(true);

    const rows = panelRows([
      t(1, "pending"),
      ...[2, 3, 4, 5, 6, 7].map((i) => t(i, "completed")),
      t(8, "pending"),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["task", "completed-group", "task"]);
    const group = rows[1]!;
    expect(group.kind === "completed-group" && group.count).toBe(6);
  });

  it("keys duplicate ids uniquely", () => {
    const keys = panelRows([t(1, "pending"), t(1, "pending")]).map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });
});
