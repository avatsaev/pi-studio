import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { OpenProjectService } from "./open-project.js";
import { WorkspaceRegistryService } from "./workspace-registry.js";

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
    broadcast: (_sessions, message) => updates.push(message as Record<string, unknown>),
    registry: new WorkspaceRegistryService(home, silentLogger()),
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
