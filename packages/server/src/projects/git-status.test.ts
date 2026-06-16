import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import type { CheckoutStatusProjection } from "./status-projection.js";
import { projectStatus } from "./status-projection.js";
import { WorkspaceGitService } from "./workspace-git-service.js";

let repo: string;
let nonGit: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
async function commitAll(cwd: string, msg: string): Promise<void> {
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", msg);
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pi-studio-gs-repo-"));
  nonGit = await mkdtemp(join(tmpdir(), "pi-studio-gs-plain-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  await writeFile(join(repo, "a.txt"), "one\n");
  await commitAll(repo, "init");
});
afterEach(async () => {
  await Promise.all([
    rm(repo, { recursive: true, force: true }),
    rm(nonGit, { recursive: true, force: true }),
  ]);
});

describe("projectStatus", () => {
  it("reports branch + clean tree", async () => {
    const status = await projectStatus(repo);
    expect(status.available).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged).toHaveLength(0);
    expect(status.untracked).toHaveLength(0);
  });

  it("classifies staged, unstaged, and untracked changes", async () => {
    await writeFile(join(repo, "a.txt"), "two\n"); // modify tracked (unstaged)
    await writeFile(join(repo, "b.txt"), "new\n"); // untracked
    git(repo, "add", "b.txt"); // stage the new file
    const status = await projectStatus(repo);
    expect(status.unstaged.map((e) => e.path)).toContain("a.txt");
    expect(status.staged.map((e) => e.path)).toContain("b.txt");
  });

  it("surfaces merge conflicts in the projection", async () => {
    // Create a conflict on a.txt across two branches.
    git(repo, "checkout", "-q", "-b", "feature");
    await writeFile(join(repo, "a.txt"), "feature change\n");
    await commitAll(repo, "feature");
    git(repo, "checkout", "-q", "main");
    await writeFile(join(repo, "a.txt"), "main change\n");
    await commitAll(repo, "main edit");
    try {
      git(repo, "merge", "feature");
    } catch {
      // merge exits non-zero on conflict — expected
    }
    const status = await projectStatus(repo);
    expect(status.hasConflicts).toBe(true);
    expect(status.conflicted).toContain("a.txt");
  });

  it("reports git unavailable for a non-git directory", async () => {
    const status = await projectStatus(nonGit);
    expect(status.available).toBe(false);
    expect(status.unavailableReason).toBe("not_a_git_repository");
  });
});

describe("WorkspaceGitService streaming", () => {
  it("emits a snapshot on subscribe and a new update only when status changes (no polling)", async () => {
    const svc = new WorkspaceGitService();
    const seen: CheckoutStatusProjection[] = [];
    const unsub = svc.subscribe(repo, (p) => seen.push(p));
    // Wait for the immediate snapshot emit.
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);

    // No change → refresh emits nothing (dedupe).
    expect(await svc.refresh(repo)).toBe(false);
    expect(seen).toHaveLength(1);

    // Change the tree → refresh emits an update.
    await writeFile(join(repo, "a.txt"), "changed\n");
    expect(await svc.refresh(repo)).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.unstaged.map((e) => e.path)).toContain("a.txt");

    unsub();
    // After unsubscribe, refresh is a no-op.
    await writeFile(join(repo, "a.txt"), "again\n");
    expect(await svc.refresh(repo)).toBe(false);
    expect(seen).toHaveLength(2);
  });
});

describe("CheckoutDiffManager", () => {
  it("streams a diff on subscribe and stops after unsubscribe", async () => {
    await writeFile(join(repo, "a.txt"), "one\ntwo\nthree\n");
    const manager = new CheckoutDiffManager();
    const updates: string[] = [];
    const id = await manager.subscribe({ cwd: repo }, (u) => updates.push(u.patch));
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.join("")).toContain("a.txt");

    expect(manager.unsubscribe(id)).toBe(true);
    expect(manager.hasSubscription(id)).toBe(false);
    // Refresh after unsubscribe does nothing.
    expect(await manager.refresh(id)).toBe(false);
  });

  it("chunks large diffs across multiple updates", async () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(join(repo, "a.txt"), `${big}\n`);
    const manager = new CheckoutDiffManager();
    const updates: { chunk: number; totalChunks: number; done: boolean }[] = [];
    await manager.subscribe({ cwd: repo, chunkSize: 1024 }, (u) =>
      updates.push({ chunk: u.chunk, totalChunks: u.totalChunks, done: u.done }),
    );
    expect(updates.length).toBeGreaterThan(1);
    expect(updates[updates.length - 1]!.done).toBe(true);
  });
});
