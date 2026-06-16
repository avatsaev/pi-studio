import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceRegistryService } from "./workspace-registry.js";
import {
  AUTO_ARCHIVE_LABEL,
  resolveWorktreeName,
  slugBranchName,
  WORKTREE_WORKSPACE_ID_LABEL,
  WorktreeService,
  type AgentLike,
} from "./worktree-service.js";

let home: string;
let repo: string;
let worktreeRoot: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-wt-home-"));
  repo = await mkdtemp(join(tmpdir(), "pi-studio-wt-repo-"));
  worktreeRoot = join(home, "worktrees");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
});
afterEach(async () => {
  await Promise.all([
    rm(home, { recursive: true, force: true }),
    rm(repo, { recursive: true, force: true }),
  ]);
});

describe("name resolution", () => {
  it("slugs names and appends a deterministic hash suffix on collision / over-length", () => {
    expect(slugBranchName("Fix the Bug!")).toBe("fix-the-bug");
    const a = resolveWorktreeName("feature", new Set());
    expect(a).toBe("feature");
    const b = resolveWorktreeName("feature", new Set(["feature"]));
    expect(b).toMatch(/^feature-[0-9a-f]{7}$/);
    // Deterministic: same inputs → same suffix.
    expect(resolveWorktreeName("feature", new Set(["feature"]))).toBe(b);
    // Over-length truncates + suffix.
    const long = resolveWorktreeName("x".repeat(200), new Set());
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/-[0-9a-f]{7}$/);
  });
});

describe("WorktreeService.createWorktree", () => {
  it("adds a git worktree, registers a worktree workspace, and runs setup with env", async () => {
    const setupCalls: Array<{ command: string; env: Record<string, string> }> = [];
    const svc = new WorktreeService({
      home,
      worktreeRoot,
      broadcast: () => {},
      readWorktreeLifecycle: async () => ({ setup: ["echo setup"], teardown: ["echo teardown"] }),
      runCommand: async (command, opts) => {
        setupCalls.push({ command, env: opts.env });
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const descriptor = await svc.createWorktree({
      projectRoot: repo,
      projectId: "remote:github.com/a/b",
      name: "feature/login",
    });

    expect(descriptor.workspace.kind).toBe("worktree");
    expect(existsSync(descriptor.path)).toBe(true);
    expect(descriptor.setupOk).toBe(true);
    expect(setupCalls).toHaveLength(1);
    expect(setupCalls[0]!.env.PI_STUDIO_WORKTREE_PATH).toBe(descriptor.path);
    expect(setupCalls[0]!.env.PI_STUDIO_SOURCE_CHECKOUT_PATH).toBe(repo);
    // New branch was created.
    const branches = execFileSync("git", ["branch", "--list"], { cwd: repo }).toString();
    expect(branches).toContain("feature/login");
  });

  it("honors worktrees.root override for the worktree path", async () => {
    const svc = new WorktreeService({ home, worktreeRoot, broadcast: () => {} });
    const descriptor = await svc.createWorktree({
      projectRoot: repo,
      projectId: "p",
      name: "wt1",
    });
    expect(descriptor.path.startsWith(worktreeRoot)).toBe(true);
  });
});

describe("WorktreeService.archiveWorktree", () => {
  it("runs teardown, archives contained agents, and removes the git worktree", async () => {
    const archivedAgents: string[] = [];
    let teardownRan = false;
    const svc = new WorktreeService({
      home,
      worktreeRoot,
      broadcast: () => {},
      readWorktreeLifecycle: async () => ({ setup: [], teardown: ["echo bye"] }),
      runCommand: async (command) => {
        if (command === "echo bye") teardownRan = true;
        return { code: 0, stdout: "", stderr: "" };
      },
      listAgents: () => agents,
      archiveAgent: async (id) => {
        archivedAgents.push(id);
      },
    });

    const descriptor = await svc.createWorktree({ projectRoot: repo, projectId: "p", name: "wt" });
    const agents: AgentLike[] = [
      { id: "a1", cwd: descriptor.path, labels: {} },
      { id: "a2", cwd: join(descriptor.path, "sub"), labels: {} },
      { id: "outside", cwd: repo, labels: {} },
    ];

    const ok = await svc.archiveWorktree(descriptor.workspace.workspaceId);
    expect(ok).toBe(true);
    expect(teardownRan).toBe(true);
    expect(archivedAgents.toSorted()).toEqual(["a1", "a2"]);
    expect(existsSync(descriptor.path)).toBe(false);

    const reg = new WorkspaceRegistryService(home);
    expect(await reg.listActiveWorkspaces()).toHaveLength(0);
  });
});

describe("auto-archive coupling", () => {
  it("archives both agent and worktree after the first terminal turn", async () => {
    const archived: string[] = [];
    let agents: AgentLike[] = [];
    const svc = new WorktreeService({
      home,
      worktreeRoot,
      broadcast: () => {},
      listAgents: () => agents,
      archiveAgent: async (id) => archived.push(id),
    });

    const descriptor = await svc.createWorktree({
      projectRoot: repo,
      projectId: "p",
      name: "auto",
    });
    const agent: AgentLike = {
      id: "agent-1",
      cwd: descriptor.path,
      labels: {
        [AUTO_ARCHIVE_LABEL]: "true",
        [WORKTREE_WORKSPACE_ID_LABEL]: descriptor.workspace.workspaceId,
      },
    };
    agents = [agent];

    const didArchive = await svc.maybeAutoArchiveOnTerminalTurn(agent);
    expect(didArchive).toBe(true);
    expect(archived).toContain("agent-1"); // agent inside the worktree archived via cascade
    const reg = new WorkspaceRegistryService(home);
    expect(await reg.listActiveWorkspaces()).toHaveLength(0); // worktree archived

    // An agent without the labels does not auto-archive.
    expect(await svc.maybeAutoArchiveOnTerminalTurn({ id: "x", cwd: repo, labels: {} })).toBe(
      false,
    );
  });
});
