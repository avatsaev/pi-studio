import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpenProjectService } from "./open-project.js";
import { aggregateWorkspaceActivity, type AgentActivityInput } from "./workspace-activity.js";

let home: string;
let repo: string;
let plain: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-open-home-"));
  repo = await mkdtemp(join(tmpdir(), "pi-studio-open-repo-"));
  plain = await mkdtemp(join(tmpdir(), "pi-studio-open-plain-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "git@github.com:acme/widgets.git");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
});
afterEach(async () => {
  await Promise.all([
    rm(home, { recursive: true, force: true }),
    rm(repo, { recursive: true, force: true }),
    rm(plain, { recursive: true, force: true }),
  ]);
});

function makeService(): { svc: OpenProjectService; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = [];
  const svc = new OpenProjectService({
    home,
    broadcast: (_sessions, message) => updates.push(message as Record<string, unknown>),
  });
  return { svc, updates };
}

describe("OpenProjectService.openProject", () => {
  it("opens a git project: remote projectKey + local_checkout workspace + workspace_update", async () => {
    const { svc, updates } = makeService();
    const result = await svc.openProject(repo);
    expect(result.project.kind).toBe("git");
    expect(result.project.projectId).toBe("remote:github.com/acme/widgets");
    expect(result.workspace.kind).toBe("local_checkout");
    expect(result.branch).toBe("main");
    expect(updates.some((u) => u.type === "workspace_update")).toBe(true);
  });

  it("opens a non-git directory: project kind=non_git, workspace kind=directory", async () => {
    const { svc } = makeService();
    const result = await svc.openProject(plain);
    expect(result.project.kind).toBe("non_git");
    expect(result.workspace.kind).toBe("directory");
  });

  it("reuses an existing workspace on re-open", async () => {
    const { svc } = makeService();
    const a = await svc.openProject(repo);
    const b = await svc.openProject(repo);
    expect(b.created).toBe(false);
    expect(b.workspace.workspaceId).toBe(a.workspace.workspaceId);
  });
});

describe("aggregateWorkspaceActivity", () => {
  it("a running subagent escalates running to its root parent's workspace, not its own cwd", () => {
    const agents: AgentActivityInput[] = [
      { id: "root", cwd: "/work/main", status: "idle", parentAgentId: null },
      { id: "sub", cwd: "/work/wt", status: "running", parentAgentId: "root" },
    ];
    const buckets = aggregateWorkspaceActivity(agents);
    expect(buckets.get("/work/main")).toBe("running");
    expect(buckets.has("/work/wt")).toBe(false); // subagent cwd not escalated
  });

  it("non-running subagent attention/error stays in the parent's track (no workspace escalation)", () => {
    const agents: AgentActivityInput[] = [
      { id: "root", cwd: "/work/main", status: "idle", parentAgentId: null },
      { id: "sub", cwd: "/work/wt", status: "error", parentAgentId: "root" },
    ];
    const buckets = aggregateWorkspaceActivity(agents);
    expect(buckets.get("/work/main")).toBe("idle");
    expect(buckets.has("/work/wt")).toBe(false);
  });

  it("root agent contributes its own bucket, including attention", () => {
    const agents: AgentActivityInput[] = [
      { id: "r1", cwd: "/a", status: "idle", parentAgentId: null, needsAttention: true },
      { id: "r2", cwd: "/b", status: "running", parentAgentId: null },
    ];
    const buckets = aggregateWorkspaceActivity(agents);
    expect(buckets.get("/a")).toBe("attention");
    expect(buckets.get("/b")).toBe("running");
  });
});
