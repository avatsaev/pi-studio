import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { workspacesPath } from "../persistence/entity-stores.js";
import { recordingLogger } from "../test-support/recording-logger.js";
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
  it("keeps valid kinds and maps unknown to directory", () => {
    expect(normalizeWorkspaceKind("worktree")).toBe("worktree");
    expect(normalizeWorkspaceKind("directory")).toBe("directory");
    expect(normalizeWorkspaceKind("unknown")).toBe("directory");
  });
});

describe("WorkspaceRegistryService — projects", () => {
  it("creates a git project with a remote-based projectKey", async () => {
    const svc = new WorkspaceRegistryService(home, silentLogger());
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
    const svc = new WorkspaceRegistryService(home, silentLogger());
    const a = await svc.resolveOrCreateProject({ rootPath: "/work/repo", kind: "git" });
    const b = await svc.resolveOrCreateProject({ rootPath: "/work/repo/", kind: "git" });
    expect(b.projectId).toBe(a.projectId);
    expect(await svc.listActiveProjects()).toHaveLength(1);
  });
});

describe("WorkspaceRegistryService — workspaces", () => {
  it("reuses an existing active workspace for the same cwd", async () => {
    const svc = new WorkspaceRegistryService(home, silentLogger());
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
    const svc = new WorkspaceRegistryService(home, silentLogger());
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

describe("WorkspaceRegistryService — concurrent calls", () => {
  it("two concurrent workspace registrations for different folders are both recorded", async () => {
    const svc = new WorkspaceRegistryService(home, silentLogger());
    const [a, b] = await Promise.all([
      svc.resolveOrCreateWorkspace({ projectId: "p", cwd: "/w/a", kind: "directory" }),
      svc.resolveOrCreateWorkspace({ projectId: "p", cwd: "/w/b", kind: "directory" }),
    ]);
    expect([a.created, b.created]).toEqual([true, true]);
    const cwds = (await svc.listWorkspaces()).map((workspace) => workspace.cwd);
    expect(cwds.toSorted()).toEqual(["/w/a", "/w/b"]);
  });

  it("two concurrent registrations of the same folder create one workspace", async () => {
    const svc = new WorkspaceRegistryService(home, silentLogger());
    const results = await Promise.all([
      svc.resolveOrCreateWorkspace({ projectId: "p", cwd: "/w/a", kind: "directory" }),
      svc.resolveOrCreateWorkspace({ projectId: "p", cwd: "/w/a/", kind: "directory" }),
    ]);
    expect(results.map((result) => result.created)).toEqual([true, false]);
    expect(await svc.listWorkspaces()).toHaveLength(1);
  });

  it("two concurrent project registrations for different roots are both recorded", async () => {
    const svc = new WorkspaceRegistryService(home, silentLogger());
    await Promise.all([
      svc.resolveOrCreateProject({ rootPath: "/w/a", kind: "git" }),
      svc.resolveOrCreateProject({ rootPath: "/w/b", kind: "git" }),
    ]);
    const roots = (await svc.listProjects()).map((project) => project.rootPath);
    expect(roots.toSorted()).toEqual(["/w/a", "/w/b"]);
  });

  it("an archive racing a registration loses neither change", async () => {
    const svc = new WorkspaceRegistryService(home, silentLogger());
    const { workspace } = await svc.resolveOrCreateWorkspace({
      projectId: "p",
      cwd: "/w/a",
      kind: "directory",
    });
    await Promise.all([
      svc.archiveWorkspace(workspace.workspaceId),
      svc.resolveOrCreateWorkspace({ projectId: "p", cwd: "/w/b", kind: "directory" }),
    ]);
    expect((await svc.listActiveWorkspaces()).map((active) => active.cwd)).toEqual(["/w/b"]);
    expect(await svc.listWorkspaces()).toHaveLength(2);
  });
});

function workspaceJson(workspaceId: string): Record<string, unknown> {
  return {
    workspaceId,
    projectId: "p",
    cwd: `/w/${workspaceId}`,
    kind: "directory",
    displayName: workspaceId,
    createdAt: "2026-06-11T12:00:00.000Z",
    updatedAt: "2026-06-11T12:00:00.000Z",
    archivedAt: null,
  };
}

/** Write a `workspaces.json` whose middle record is invalid; returns the file's bytes. */
async function writeDamagedRegistry(): Promise<string> {
  const path = workspacesPath(home);
  await mkdir(dirname(path), { recursive: true });
  const original = JSON.stringify([
    workspaceJson("w1"),
    { ...workspaceJson("w2"), kind: "bogus" },
    workspaceJson("w3"),
  ]);
  await writeFile(path, original, "utf8");
  return original;
}

/** The contents of every file set aside next to `workspaces.json`. */
async function readSetAside(): Promise<string[]> {
  const dir = dirname(workspacesPath(home));
  const names = (await readdir(dir)).filter((name) => name.includes(".corrupt-"));
  return Promise.all(names.map((name) => readFile(join(dir, name), "utf8")));
}

describe("WorkspaceRegistryService — a registry with an invalid record", () => {
  it("a registration after it keeps the valid records instead of making the loss permanent", async () => {
    const original = await writeDamagedRegistry();
    const { logger, lines } = recordingLogger();
    const svc = new WorkspaceRegistryService(home, logger);

    const { workspace } = await svc.resolveOrCreateWorkspace({
      projectId: "p",
      cwd: "/w/new",
      kind: "directory",
    });

    const ids = (await svc.listWorkspaces()).map((record) => record.workspaceId);
    expect(ids).toEqual(["w1", "w3", workspace.workspaceId]);
    expect(await readSetAside()).toEqual([original]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error" });
  });

  it("a read racing a registration sets the file aside once and loses nothing", async () => {
    const original = await writeDamagedRegistry();
    const svc = new WorkspaceRegistryService(home, silentLogger());

    const [listed, created] = await Promise.all([
      svc.listWorkspaces(),
      svc.resolveOrCreateWorkspace({ projectId: "p", cwd: "/w/new", kind: "directory" }),
    ]);

    expect(listed.map((record) => record.workspaceId)).toEqual(["w1", "w3"]);
    const ids = (await svc.listWorkspaces()).map((record) => record.workspaceId);
    expect(ids).toEqual(["w1", "w3", created.workspace.workspaceId]);
    expect(await readSetAside()).toEqual([original]);
  });
});
