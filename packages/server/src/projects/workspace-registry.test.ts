import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveProjectKey,
  normalizePath,
  normalizeRemote,
  normalizeWorkspaceKind,
  WorkspaceRegistryService,
} from "./workspace-registry.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-reg-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("projectKey derivation", () => {
  it("normalizes git remotes to host/owner/repo", () => {
    expect(normalizeRemote("https://github.com/Owner/Repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRemote("git@github.com:Owner/Repo.git")).toBe("github.com/owner/repo");
    expect(normalizeRemote("ssh://git@gitlab.com:22/o/r")).toBe("gitlab.com/o/r");
  });

  it("derives a remote-based key when a remote is present", () => {
    expect(
      deriveProjectKey({ remote: "https://github.com/owner/repo.git", rootPath: "/x/repo" }),
    ).toBe("remote:github.com/owner/repo");
  });

  it("derives a path-based key when no remote", () => {
    expect(deriveProjectKey({ remote: null, rootPath: "/home/me/proj/" })).toBe(
      "path:/home/me/proj",
    );
    expect(normalizePath("/a/b/")).toBe("/a/b");
  });
});

describe("workspace kind normalization", () => {
  it("maps legacy checkout → local_checkout and keeps valid kinds", () => {
    expect(normalizeWorkspaceKind("checkout")).toBe("local_checkout");
    expect(normalizeWorkspaceKind("worktree")).toBe("worktree");
    expect(normalizeWorkspaceKind("directory")).toBe("directory");
    expect(normalizeWorkspaceKind("unknown")).toBe("directory");
  });
});

describe("WorkspaceRegistryService — projects", () => {
  it("creates a git project with a remote-based projectKey", async () => {
    const svc = new WorkspaceRegistryService(home);
    const project = await svc.resolveOrCreateProject({
      rootPath: "/work/repo",
      remote: "git@github.com:acme/widgets.git",
      kind: "git",
    });
    expect(project.projectId).toBe("remote:github.com/acme/widgets");
    expect(project.kind).toBe("git");
    expect(project.displayName).toBe("widgets");
  });

  it("two registrations of the same normalized rootPath resolve to one project", async () => {
    const svc = new WorkspaceRegistryService(home);
    const a = await svc.resolveOrCreateProject({ rootPath: "/work/repo", kind: "git" });
    const b = await svc.resolveOrCreateProject({ rootPath: "/work/repo/", kind: "git" });
    expect(b.projectId).toBe(a.projectId);
    expect(await svc.listActiveProjects()).toHaveLength(1);
  });
});

describe("WorkspaceRegistryService — workspaces", () => {
  it("reuses an existing active workspace for the same cwd", async () => {
    const svc = new WorkspaceRegistryService(home);
    const project = await svc.resolveOrCreateProject({ rootPath: "/w/repo", kind: "git" });
    const first = await svc.resolveOrCreateWorkspace({
      projectId: project.projectId,
      cwd: "/w/repo",
      kind: "local_checkout",
    });
    expect(first.created).toBe(true);
    const second = await svc.resolveOrCreateWorkspace({
      projectId: project.projectId,
      cwd: "/w/repo/",
      kind: "checkout",
    });
    expect(second.created).toBe(false);
    expect(second.workspace.workspaceId).toBe(first.workspace.workspaceId);
  });

  it("archiving a workspace sets archivedAt and removes it from active lists", async () => {
    const svc = new WorkspaceRegistryService(home);
    const project = await svc.resolveOrCreateProject({ rootPath: "/w/r", kind: "non_git" });
    const { workspace } = await svc.resolveOrCreateWorkspace({
      projectId: project.projectId,
      cwd: "/w/r/sub",
      kind: "directory",
    });
    const archived = await svc.archiveWorkspace(workspace.workspaceId);
    expect(archived?.archivedAt).toBeTruthy();
    expect(await svc.listActiveWorkspaces()).toHaveLength(0);
    expect(await svc.listWorkspaces()).toHaveLength(1);
  });
});
