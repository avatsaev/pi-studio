import { describe, expect, it } from "vitest";
import {
  addReviewComment,
  buildGitActions,
  buildPrAttachment,
  canAttachToComposer,
  canCommit,
  commentsForLine,
  deleteReviewComment,
  diffEmptyMessage,
  diffViewEmptyReason,
  groupChanges,
  INITIAL_COMMIT_BOX,
  INITIAL_DIFF_STATE,
  INITIAL_REVIEW_STORE,
  isDirty,
  sortActivitiesChronologically,
  updateReviewComment,
  type FileChange,
  type PrActivity,
  type PrActivityFeed,
} from "./index.js";

const files: FileChange[] = [
  { path: "src/a.ts", status: "modified", staging: "staged", added: 3, deleted: 1 },
  { path: "src/b.ts", status: "added", staging: "unstaged", added: 10, deleted: 0 },
  { path: "src/c.ts", status: "untracked", staging: "untracked", added: 0, deleted: 0 },
];

describe("changes grouping", () => {
  it("groups files into staged / unstaged / untracked", () => {
    const groups = groupChanges(files);
    expect(groups.map((g) => g.label)).toEqual(["Staged", "Unstaged", "Untracked"]);
    expect(groups[0]!.files[0]!.path).toBe("src/a.ts");
  });

  it("isDirty returns false for empty groups", () => {
    expect(isDirty(groupChanges([]))).toBe(false);
    expect(isDirty(groupChanges(files))).toBe(true);
  });

  it("canCommit requires message and staged files", () => {
    const groups = groupChanges(files);
    expect(canCommit({ ...INITIAL_COMMIT_BOX, message: "fix: bug" }, groups)).toBe(true);
    expect(canCommit({ ...INITIAL_COMMIT_BOX, message: "" }, groups)).toBe(false);
    expect(canCommit({ ...INITIAL_COMMIT_BOX, message: "fix" }, groupChanges([]))).toBe(false);
  });
});

describe("diff view state", () => {
  it("diffViewEmptyReason returns not-git when not a git repo", () => {
    expect(diffViewEmptyReason({ ...INITIAL_DIFF_STATE, isGitRepo: false }, 0)).toBe("not-git");
    expect(diffEmptyMessage("not-git")).toBe("Not a git repository");
  });

  it("returns uncommitted message for clean working tree", () => {
    const reason = diffViewEmptyReason(INITIAL_DIFF_STATE, 0);
    expect(reason).toBe("uncommitted");
    expect(diffEmptyMessage("uncommitted")).toBe("No uncommitted changes");
  });

  it("returns null when files > 0", () => {
    expect(diffViewEmptyReason(INITIAL_DIFF_STATE, 3)).toBeNull();
  });

  it("returns whitespace-hidden when whitespace is hidden", () => {
    expect(diffViewEmptyReason({ ...INITIAL_DIFF_STATE, hideWhitespace: true }, 0)).toBe("whitespace-hidden");
  });
});

describe("git actions", () => {
  it("selects commit as primary action when dirty", () => {
    const cluster = buildGitActions({ isDirty: true, isBehind: false, isWorktree: false, hasPr: false, hasBase: false, committing: false, pushing: false });
    expect(cluster.primary.id).toBe("commit");
    expect(cluster.primary.disabled).toBe(false);
  });

  it("selects archive-worktree as primary for worktrees even if dirty", () => {
    const cluster = buildGitActions({ isDirty: true, isBehind: false, isWorktree: true, hasPr: false, hasBase: false, committing: false, pushing: false });
    expect(cluster.primary.id).toBe("archive-worktree");
  });

  it("view-pr is primary when PR exists and repo is clean", () => {
    const cluster = buildGitActions({ isDirty: false, isBehind: false, isWorktree: false, hasPr: true, hasBase: false, committing: false, pushing: false });
    expect(cluster.primary.id).toBe("view-pr");
  });

  it("unavailable actions carry messages", () => {
    const cluster = buildGitActions({ isDirty: false, isBehind: false, isWorktree: false, hasPr: false, hasBase: false, committing: false, pushing: false });
    const commitAction = [...cluster.secondary, ...cluster.menu].find((a) => a.id === "commit");
    expect(commitAction?.unavailableMessage).toBeTruthy();
  });
});

describe("PR activity timeline", () => {
  const activities: PrActivity[] = [
    { kind: "review_comment", id: "c1", author: "alice", body: "Nice", filePath: "src/a.ts", lineNumber: 3, timestamp: 3000, canAttach: true },
    { kind: "check_run", id: "r1", name: "CI", status: "failure", logsUrl: "https://ci.example", timestamp: 1000, canAttach: true },
    { kind: "review_state", id: "s1", author: "bob", state: "approved", timestamp: 2000, canAttach: false },
  ];

  it("sorts activities chronologically by timestamp", () => {
    const sorted = sortActivitiesChronologically(activities);
    expect(sorted.map((a) => a.id)).toEqual(["r1", "s1", "c1"]);
  });

  it("canAttachToComposer follows the canAttach flag", () => {
    expect(canAttachToComposer(activities[0]!)).toBe(true);
    expect(canAttachToComposer(activities[2]!)).toBe(false);
  });

  it("buildPrAttachment builds a correctly shaped attachment", () => {
    const feed: PrActivityFeed = { prNumber: 42, prTitle: "Fix bug", prUrl: "https://gh.test/42", activities, loading: false };
    const att = buildPrAttachment(feed, activities[0]!);
    expect(att.prNumber).toBe(42);
    expect(att.location).toContain("src/a.ts:3");
    expect(att.body).toBe("Nice");
  });
});

describe("inline review comments", () => {
  it("add, update, delete draft review comments", () => {
    let store = addReviewComment(INITIAL_REVIEW_STORE, { filePath: "src/a.ts", side: "new", lineNumber: 5, body: "Check this" });
    expect(store.comments).toHaveLength(1);
    const id = store.comments[0]!.id;
    store = updateReviewComment(store, id, "Updated comment");
    expect(store.comments[0]!.body).toBe("Updated comment");
    store = deleteReviewComment(store, id);
    expect(store.comments).toHaveLength(0);
  });

  it("commentsForLine filters by file + side + line", () => {
    let store = addReviewComment(INITIAL_REVIEW_STORE, { filePath: "src/a.ts", side: "new", lineNumber: 5, body: "A" });
    store = addReviewComment(store, { filePath: "src/a.ts", side: "old", lineNumber: 5, body: "B" });
    expect(commentsForLine(store, "src/a.ts", "new", 5)).toHaveLength(1);
    expect(commentsForLine(store, "src/a.ts", "old", 5)).toHaveLength(1);
    expect(commentsForLine(store, "src/a.ts", "new", 99)).toHaveLength(0);
  });
});
