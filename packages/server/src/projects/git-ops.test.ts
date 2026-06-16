import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitOperationsService, validateBranchName } from "./git-operations.js";
import { defaultGitRunner } from "./git-detect.js";

let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd }).toString();
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pi-studio-ops-repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  await writeFile(join(repo, "a.txt"), "one\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("commit", () => {
  it("generates a message via structured generation when none is provided", async () => {
    const generate = vi.fn(async () => "Auto-generated commit");
    const svc = new GitOperationsService({ generate });
    await writeFile(join(repo, "a.txt"), "two\n");
    const result = await svc.commit({ cwd: repo, all: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.generated).toBe(true);
      expect(result.message).toBe("Auto-generated commit");
    }
    expect(generate).toHaveBeenCalledWith("commit_message", expect.anything());
    expect(git(repo, "log", "-1", "--pretty=%s")).toContain("Auto-generated commit");
  });

  it("uses an explicit message without generating", async () => {
    const generate = vi.fn(async () => "should-not-be-used");
    const svc = new GitOperationsService({ generate });
    await writeFile(join(repo, "b.txt"), "new\n");
    const result = await svc.commit({ cwd: repo, all: true, message: "explicit msg" });
    expect(result.ok).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(git(repo, "log", "-1", "--pretty=%s")).toContain("explicit msg");
  });
});

describe("branch operations", () => {
  it("switch (create), rename, and stash round-trip execute", async () => {
    const svc = new GitOperationsService();
    const sw = await svc.switchBranch(repo, { branch: "Feature Login!", create: true });
    expect(sw.ok).toBe(true);
    if (sw.ok) expect(sw.branch).toBe("feature-login"); // slugged
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("feature-login");

    const rn = await svc.renameBranch(repo, { to: "renamed-branch" });
    expect(rn.ok).toBe(true);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("renamed-branch");

    // Stash round-trip.
    await writeFile(join(repo, "a.txt"), "dirty\n");
    const save = await svc.stashSave(repo, "wip");
    expect(save.ok).toBe(true);
    expect(git(repo, "status", "--porcelain").trim()).toBe(""); // clean after stash
    const list = await svc.stashList(repo);
    expect(list.ok).toBe(true);
    if (list.ok) expect((list.entries as string[]).length).toBe(1);
    const pop = await svc.stashPop(repo);
    expect(pop.ok).toBe(true);
    expect(git(repo, "status", "--porcelain")).toContain("a.txt");
  });
});

describe("branch validation + suggestions", () => {
  it("rejects invalid branch names and offers slugged suggestions", async () => {
    const bad = await validateBranchName(repo, "bad name with spaces", defaultGitRunner);
    expect(bad.valid).toBe(false);
    const good = await validateBranchName(repo, "good-branch", defaultGitRunner);
    expect(good.valid).toBe(true);

    const svc = new GitOperationsService({ generate: async () => "Add Login Feature" });
    const suggestions = await svc.branchSuggestions("add login feature");
    expect(suggestions[0]).toBe("add-login-feature");
    expect(suggestions.every((s) => !/\s/.test(s))).toBe(true);
  });
});

describe("push error surfacing", () => {
  it("surfaces a non-fast-forward rejection as a git error", async () => {
    // Bare remote + two clones that diverge → push from the stale clone is rejected.
    const remote = await mkdtemp(join(tmpdir(), "pi-studio-ops-remote-"));
    const clone2 = await mkdtemp(join(tmpdir(), "pi-studio-ops-clone2-"));
    try {
      git(remote, "init", "-q", "--bare");
      git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
      git(repo, "remote", "add", "origin", remote);
      git(repo, "push", "-q", "-u", "origin", "main");

      execFileSync("git", ["clone", "-q", remote, clone2]);
      git(clone2, "config", "user.email", "t@example.com");
      git(clone2, "config", "user.name", "T");
      // Advance the remote from clone2.
      await writeFile(join(clone2, "c.txt"), "x\n");
      git(clone2, "add", ".");
      git(clone2, "commit", "-q", "-m", "remote advance");
      git(clone2, "push", "-q", "origin", "main");

      // Diverge the original repo so its push is non-fast-forward.
      await writeFile(join(repo, "a.txt"), "diverged\n");
      git(repo, "commit", "-q", "-am", "local diverge");

      const svc = new GitOperationsService();
      const result = await svc.push(repo, { remote: "origin", branch: "main" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("non_fast_forward");
    } finally {
      await Promise.all([
        rm(remote, { recursive: true, force: true }),
        rm(clone2, { recursive: true, force: true }),
      ]);
    }
  });
});
