import { describe, it, expect } from "vitest";
import {
  deriveCheckoutState,
  deriveCheckoutBadge,
  isStaleBranch,
  buildGitNotification,
  STALE_BRANCH_DAYS,
} from "./checkout-status.js";

describe("deriveCheckoutState / badge", () => {
  it("classifies clean/dirty/ahead/behind/diverged", () => {
    expect(deriveCheckoutState({ isDirty: false })).toBe("clean");
    expect(deriveCheckoutState({ isDirty: true })).toBe("dirty");
    expect(deriveCheckoutState({ isDirty: false, aheadCount: 2 })).toBe("ahead");
    expect(deriveCheckoutState({ isDirty: false, behindCount: 3 })).toBe("behind");
    expect(deriveCheckoutState({ isDirty: false, aheadCount: 1, behindCount: 1 })).toBe("diverged");
  });

  it("builds a clean badge with a check icon + success tone", () => {
    const b = deriveCheckoutBadge({ isDirty: false, branch: "main" });
    expect(b).toMatchObject({ branch: "main", state: "clean", icon: "check", tone: "success", label: "main" });
  });

  it("labels ahead/behind counts", () => {
    expect(deriveCheckoutBadge({ isDirty: false, branch: "main", aheadCount: 2 }).label).toBe("main ↑2");
    expect(deriveCheckoutBadge({ isDirty: false, branch: "dev", behindCount: 3 }).label).toBe("dev ↓3");
    expect(deriveCheckoutBadge({ isDirty: false, branch: "x", aheadCount: 1, behindCount: 2 }).label).toBe("x ↑1↓2");
  });

  it("marks a dirty branch with a bullet and warning tone", () => {
    const b = deriveCheckoutBadge({ isDirty: true, branch: "main" });
    expect(b.icon).toBe("dot");
    expect(b.tone).toBe("warning");
    expect(b.label).toBe("main •");
  });
});

describe("isStaleBranch", () => {
  const now = 10 * 24 * 60 * 60 * 1000; // day 10

  it("is stale when behind and last sync older than the threshold", () => {
    const status = { isDirty: false, behindCount: 5, lastUpstreamSyncMs: 0 };
    expect(isStaleBranch(status, now)).toBe(true);
  });

  it("is not stale when up to date or recently synced", () => {
    expect(isStaleBranch({ isDirty: false, behindCount: 0, lastUpstreamSyncMs: 0 }, now)).toBe(false);
    const recent = now - (STALE_BRANCH_DAYS - 1) * 24 * 60 * 60 * 1000;
    expect(isStaleBranch({ isDirty: false, behindCount: 5, lastUpstreamSyncMs: recent }, now)).toBe(false);
  });

  it("is not stale when the last sync time is unknown", () => {
    expect(isStaleBranch({ isDirty: false, behindCount: 5 }, now)).toBe(false);
  });
});

describe("buildGitNotification", () => {
  it("push success", () => {
    expect(buildGitNotification({ type: "push_success", count: 3, branch: "main" })).toEqual({
      tone: "success",
      title: "Pushed 3 commits to origin/main",
    });
    expect(buildGitNotification({ type: "push_success", count: 1, branch: "x" }).title).toBe("Pushed 1 commit to origin/x");
  });

  it("pull new commits", () => {
    expect(buildGitNotification({ type: "pull_new", count: 2 }).title).toBe("Pulled 2 new commits");
  });

  it("conflict with an action to open the changes tab", () => {
    const n = buildGitNotification({ type: "conflict", files: ["a", "b"] });
    expect(n.tone).toBe("error");
    expect(n.title).toBe("Merge conflict in 2 files");
    expect(n.action).toEqual({ label: "View changes", target: "changes" });
  });

  it("worktree created", () => {
    expect(buildGitNotification({ type: "worktree_created", path: "/tmp/wt" }).title).toBe("Worktree created at /tmp/wt");
  });
});
