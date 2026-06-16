import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectRecord, WorkspaceRecord } from "../persistence/entity-schemas.js";
import { loadProjects, saveProjects, saveWorkspaces } from "../persistence/entity-stores.js";
import { reconcileRegistries } from "./reconciliation.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-recon-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function project(id: string, rootPath: string, createdAt: string): ProjectRecord {
  return {
    projectId: id,
    rootPath,
    kind: "git",
    displayName: id,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

function workspace(id: string, projectId: string, cwd: string): WorkspaceRecord {
  return {
    workspaceId: id,
    projectId,
    cwd,
    kind: "local_checkout",
    displayName: id,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}

describe("reconcileRegistries", () => {
  it("migrates workspaces off a path-keyed duplicate onto the remote-keyed canonical and archives the empty", async () => {
    await saveProjects(home, [
      project("path:/work/repo", "/work/repo", "2024-01-01T00:00:00.000Z"),
      project("remote:github.com/acme/repo", "/work/repo", "2024-01-02T00:00:00.000Z"),
    ]);
    await saveWorkspaces(home, [workspace("ws1", "path:/work/repo", "/work/repo")]);

    const result = await reconcileRegistries(home);

    expect(result.migratedWorkspaceIds).toEqual(["ws1"]);
    expect(result.archivedProjectIds).toEqual(["path:/work/repo"]);

    const projects = await loadProjects(home);
    const pathProject = projects.find((p) => p.projectId === "path:/work/repo");
    const remoteProject = projects.find((p) => p.projectId === "remote:github.com/acme/repo");
    expect(pathProject?.archivedAt).toBeTruthy();
    expect(remoteProject?.archivedAt).toBeFalsy();
  });

  it("leaves a single project per rootPath untouched", async () => {
    await saveProjects(home, [
      project("remote:github.com/a/b", "/w/x", "2024-01-01T00:00:00.000Z"),
    ]);
    await saveWorkspaces(home, [workspace("ws1", "remote:github.com/a/b", "/w/x")]);
    const result = await reconcileRegistries(home);
    expect(result.archivedProjectIds).toEqual([]);
    expect(result.migratedWorkspaceIds).toEqual([]);
  });

  it("when no remote-keyed project exists, the oldest path-keyed project wins", async () => {
    await saveProjects(home, [
      project("path:/w/r#new", "/w/r", "2024-02-01T00:00:00.000Z"),
      project("path:/w/r#old", "/w/r", "2024-01-01T00:00:00.000Z"),
    ]);
    await saveWorkspaces(home, [
      workspace("wsA", "path:/w/r#new", "/w/r"),
      workspace("wsB", "path:/w/r#old", "/w/r/sub"),
    ]);
    const result = await reconcileRegistries(home);
    // Older project is canonical → the newer one is archived and its workspace migrated.
    expect(result.archivedProjectIds).toEqual(["path:/w/r#new"]);
    expect(result.migratedWorkspaceIds).toEqual(["wsA"]);
  });
});
