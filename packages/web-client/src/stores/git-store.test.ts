import { beforeEach, describe, expect, it } from "vitest";
import { useGitStore, type CheckoutStatusProjection } from "./git-store.js";

const BASE_PROJECTION: CheckoutStatusProjection = {
  available: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  detached: false,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
  hasConflicts: false,
};

beforeEach(() => {
  useGitStore.setState({
    subscribedCwd: null,
    changes: [],
    available: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    conflictCount: 0,
  });
});

describe("git store — branch metadata (sprint-042)", () => {
  it("applyProjection retains branch/ahead/behind/detached/upstream/conflict count", () => {
    useGitStore.getState().applyProjection({
      ...BASE_PROJECTION,
      branch: "main",
      ahead: 2,
      behind: 1,
      conflicted: ["a.ts", "b.ts"],
      hasConflicts: true,
    });
    const s = useGitStore.getState();
    expect(s.available).toBe(true);
    expect(s.branch).toBe("main");
    expect(s.upstream).toBe("origin/main");
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.detached).toBe(false);
    expect(s.conflictCount).toBe(2);
  });

  it("applying an unavailable projection resets branch metadata and clears changes", () => {
    useGitStore.getState().applyProjection({ ...BASE_PROJECTION, ahead: 3 });
    expect(useGitStore.getState().ahead).toBe(3);

    useGitStore.getState().applyProjection({ ...BASE_PROJECTION, available: false });
    const s = useGitStore.getState();
    expect(s.available).toBe(false);
    expect(s.branch).toBeNull();
    expect(s.upstream).toBeNull();
    expect(s.ahead).toBe(0);
    expect(s.behind).toBe(0);
    expect(s.detached).toBe(false);
    expect(s.conflictCount).toBe(0);
    expect(s.changes).toEqual([]);
  });

  it("applying null/undefined resets branch metadata (no cwd subscribed)", () => {
    useGitStore.getState().applyProjection({ ...BASE_PROJECTION, branch: "feature-x" });
    expect(useGitStore.getState().branch).toBe("feature-x");

    useGitStore.getState().applyProjection(null);
    expect(useGitStore.getState().branch).toBeNull();
    expect(useGitStore.getState().available).toBe(false);
  });

  it("a detached HEAD projection is reflected", () => {
    useGitStore.getState().applyProjection({ ...BASE_PROJECTION, branch: null, detached: true });
    const s = useGitStore.getState();
    expect(s.detached).toBe(true);
    expect(s.branch).toBeNull();
    expect(s.available).toBe(true);
  });

  it("changes[] mapping (staged/unstaged/untracked) is unaffected by the new metadata", () => {
    useGitStore.getState().applyProjection({
      ...BASE_PROJECTION,
      staged: [{ path: "a.ts", indexStatus: "A", worktreeStatus: " " }],
      unstaged: [{ path: "b.ts", indexStatus: " ", worktreeStatus: "M" }],
      untracked: ["c.ts"],
    });
    const changes = useGitStore.getState().changes;
    expect(changes).toEqual([
      { path: "a.ts", status: "added", staged: true },
      { path: "b.ts", status: "modified", staged: false },
      { path: "c.ts", status: "added", staged: false },
    ]);
  });
});
