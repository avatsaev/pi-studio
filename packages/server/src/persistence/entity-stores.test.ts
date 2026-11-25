import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { recordingLogger } from "../test-support/recording-logger.js";
import { ensureDirectoryLayout } from "./atomic-store.js";
import type { AgentRecord, ProjectRecord, WorkspaceRecord } from "./entity-schemas.js";
import {
  agentFilePath,
  loadAgent,
  loadAllAgents,
  loadProjects,
  loadWorkspaces,
  projectsPath,
  sanitizeCwd,
  saveAgent,
  saveProjects,
  saveWorkspaces,
  workspacesPath,
} from "./entity-stores.js";

const NOW = "2026-06-11T12:00:00.000Z";

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "pi-studio-entities-"));
  await ensureDirectoryLayout(home);
  return home;
}

describe("sanitizeCwd", () => {
  it("strips the POSIX root and joins segments with '-'", () => {
    expect(sanitizeCwd("/home/user/project")).toBe("home-user-project");
    expect(sanitizeCwd("/a//b/")).toBe("a-b");
  });

  it("maps a Windows drive to a C-style prefix", () => {
    expect(sanitizeCwd("C:\\Users\\me\\repo")).toBe("C-Users-me-repo");
  });

  it("is stable for the same input", () => {
    expect(sanitizeCwd("/x/y")).toBe(sanitizeCwd("/x/y"));
  });
});

describe("agent store", () => {
  const agent: AgentRecord = {
    id: randomUUID(),
    provider: "pi",
    cwd: "/home/user/project",
    createdAt: NOW,
    updatedAt: NOW,
    labels: { "pi-studio.parent-agent-id": "parent-1" },
    lastStatus: "idle",
    features: [
      { type: "toggle", id: "web", label: "Web", value: true },
      { type: "select", id: "mode", label: "Mode", value: null, options: [{ value: "fast" }] },
    ],
  };

  it("persists to agents/{sanitized-cwd}/{id}.json and round-trips through Zod", async () => {
    const home = await tempHome();
    await saveAgent(home, agent);
    const path = agentFilePath(home, agent.cwd, agent.id);
    expect(path).toContain(join("agents", "home-user-project", `${agent.id}.json`));
    expect(existsSync(path)).toBe(true);
    const loaded = await loadAgent(home, agent.cwd, agent.id, silentLogger());
    expect(loaded).toEqual(agent);
  });

  it("writes no `timeline` key, and still loads an old record file that has one", async () => {
    const home = await tempHome();
    await saveAgent(home, agent);
    const path = agentFilePath(home, agent.cwd, agent.id);
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk).not.toHaveProperty("timeline");

    await writeFile(path, JSON.stringify({ ...onDisk, timeline: [] }), "utf8");
    const loaded = await loadAgent(home, agent.cwd, agent.id, silentLogger());
    expect(loaded?.id).toBe(agent.id);
  });

  it("tolerates unknown/optional fields on load", async () => {
    const home = await tempHome();
    await saveAgent(home, agent);
    const path = agentFilePath(home, agent.cwd, agent.id);
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    onDisk.futureField = { added: "later" };
    await writeFile(path, JSON.stringify(onDisk), "utf8");
    const loaded = await loadAgent(home, agent.cwd, agent.id, silentLogger());
    expect((loaded as Record<string, unknown>).futureField).toEqual({ added: "later" });
  });

  it("returns null for a missing agent", async () => {
    const home = await tempHome();
    expect(await loadAgent(home, "/nope", randomUUID(), silentLogger())).toBeNull();
  });

  it("sets a damaged record aside, logs it, and loads as null", async () => {
    const home = await tempHome();
    const path = agentFilePath(home, agent.cwd, agent.id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ torn", "utf8");
    const { logger, lines } = recordingLogger();

    expect(await loadAgent(home, agent.cwd, agent.id, logger)).toBeNull();

    expect(existsSync(path)).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", obj: { path } });
  });
});

function projectRecord(projectId: string): ProjectRecord {
  return {
    projectId,
    rootPath: `/work/${projectId}`,
    kind: "git",
    displayName: projectId,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}

function workspaceRecord(workspaceId: string): WorkspaceRecord {
  return {
    workspaceId,
    projectId: "p1",
    cwd: `/work/${workspaceId}`,
    kind: "directory",
    displayName: workspaceId,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}

/** The contents of every `<name>.corrupt-<timestamp>` file next to `path`. */
async function readSetAside(path: string): Promise<string[]> {
  const dir = dirname(path);
  const prefix = `${basename(path)}.corrupt-`;
  const names = (await readdir(dir)).filter((name) => name.startsWith(prefix)).toSorted();
  return Promise.all(names.map((name) => readFile(join(dir, name), "utf8")));
}

describe("project + workspace registries", () => {
  it("load arrays with archivedAt soft-delete fields", async () => {
    const home = await tempHome();
    await saveProjects(home, [
      {
        projectId: "remote:github.com/owner/repo",
        rootPath: "/home/user/repo",
        kind: "git",
        displayName: "repo",
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
      },
    ]);
    await saveWorkspaces(home, [
      {
        workspaceId: "ws1",
        projectId: "remote:github.com/owner/repo",
        cwd: "/home/user/repo",
        kind: "local_checkout",
        displayName: "main",
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: "2026-06-11T13:00:00.000Z",
      },
    ]);

    const projects = await loadProjects(home, silentLogger());
    const workspaces = await loadWorkspaces(home, silentLogger());
    expect(projects[0]?.archivedAt).toBeNull();
    expect(workspaces[0]?.archivedAt).toBe("2026-06-11T13:00:00.000Z");
  });

  it("default to empty arrays when missing", async () => {
    const home = await tempHome();
    expect(await loadProjects(home, silentLogger())).toEqual([]);
    expect(await loadWorkspaces(home, silentLogger())).toEqual([]);
  });

  it("keeps the valid workspaces when one is invalid, and sets the original aside", async () => {
    const home = await tempHome();
    const path = workspacesPath(home);
    const original = JSON.stringify(
      [workspaceRecord("w1"), { ...workspaceRecord("w2"), kind: "bogus" }, workspaceRecord("w3")],
      null,
      2,
    );
    await writeFile(path, original, "utf8");
    const { logger, lines } = recordingLogger();

    const loaded = await loadWorkspaces(home, logger);

    expect(loaded.map((workspace) => workspace.workspaceId)).toEqual(["w1", "w3"]);
    expect(await readSetAside(path)).toEqual([original]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      obj: {
        path,
        quarantinedTo: expect.stringContaining(`${path}.corrupt-`),
        reason: expect.stringContaining("1 of 3 records invalid"),
      },
    });

    // The valid records were written back: the next load is clean and sets nothing more aside.
    const next = recordingLogger();
    const again = await loadWorkspaces(home, next.logger);
    expect(again.map((workspace) => workspace.workspaceId)).toEqual(["w1", "w3"]);
    expect(next.lines).toEqual([]);
    expect(await readSetAside(path)).toEqual([original]);
  });

  it("keeps the valid projects when one is invalid, and sets the original aside", async () => {
    const home = await tempHome();
    const path = projectsPath(home);
    const original = JSON.stringify([
      { ...projectRecord("p1"), rootPath: undefined },
      projectRecord("p2"),
    ]);
    await writeFile(path, original, "utf8");
    const { logger, lines } = recordingLogger();

    const loaded = await loadProjects(home, logger);

    expect(loaded.map((project) => project.projectId)).toEqual(["p2"]);
    expect(await readSetAside(path)).toEqual([original]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      obj: { path, reason: expect.stringContaining("1 of 2 records invalid") },
    });
    expect(await loadProjects(home, silentLogger())).toEqual(loaded);
  });

  it.each([
    ["not JSON", "{ torn"],
    ["not an array", JSON.stringify(workspaceRecord("w1"))],
  ])("sets aside a workspaces file that is %s, and starts empty", async (_name, original) => {
    const home = await tempHome();
    const path = workspacesPath(home);
    await writeFile(path, original, "utf8");
    const { logger, lines } = recordingLogger();

    expect(await loadWorkspaces(home, logger)).toEqual([]);

    expect(existsSync(path)).toBe(false);
    expect(await readSetAside(path)).toEqual([original]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", obj: { path } });
  });

  it("leaves a registry whose records are all valid untouched", async () => {
    const home = await tempHome();
    const path = workspacesPath(home);
    const original = JSON.stringify([workspaceRecord("w1"), workspaceRecord("w2")]);
    await writeFile(path, original, "utf8");
    const { logger, lines } = recordingLogger();

    expect(await loadWorkspaces(home, logger)).toHaveLength(2);

    expect(lines).toEqual([]);
    expect(await readSetAside(path)).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(original);
  });
});

function agentRecord(cwd: string): AgentRecord {
  return {
    id: randomUUID(),
    provider: "pi",
    cwd,
    createdAt: NOW,
    updatedAt: NOW,
    labels: {},
    lastStatus: "idle",
  };
}

describe("loadAllAgents", () => {
  it("loads every record", async () => {
    const home = await tempHome();
    const a = agentRecord("/work/a");
    const b = agentRecord("/work/b");
    await saveAgent(home, a);
    await saveAgent(home, b);
    const { logger, lines } = recordingLogger();

    const loaded = await loadAllAgents(home, logger);

    expect(loaded.map((record) => record.id).toSorted()).toEqual([a.id, b.id].toSorted());
    expect(lines).toEqual([]);
  });

  it("sets a damaged record aside and logs it; the others load", async () => {
    const home = await tempHome();
    const good = agentRecord("/work/a");
    const bad = agentRecord("/work/a");
    await saveAgent(home, good);
    const badPath = agentFilePath(home, bad.cwd, bad.id);
    await writeFile(badPath, "{ torn", "utf8");
    const { logger, lines } = recordingLogger();

    const loaded = await loadAllAgents(home, logger);

    expect(loaded.map((record) => record.id)).toEqual([good.id]);
    expect(existsSync(badPath)).toBe(false);
    expect(await readSetAside(badPath)).toEqual(["{ torn"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", obj: { path: badPath } });

    // The set-aside file is not an agent record: the next recovery is quiet.
    const next = recordingLogger();
    expect(await loadAllAgents(home, next.logger)).toHaveLength(1);
    expect(next.lines).toEqual([]);
  });

  it("logs and skips a dangling symlink and an entry it cannot read; the others load", async () => {
    const home = await tempHome();
    const good = agentRecord("/work/a");
    await saveAgent(home, good);
    const dir = dirname(agentFilePath(home, good.cwd, good.id));
    const danglingDirectory = join(home, "agents", "ghost-directory");
    const danglingFile = join(dir, "ghost.json");
    const unreadable = join(dir, "directory.json");
    await symlink(join(home, "nowhere"), danglingDirectory);
    await symlink(join(home, "nowhere.json"), danglingFile);
    await mkdir(unreadable);
    const { logger, lines } = recordingLogger();

    const loaded = await loadAllAgents(home, logger);

    expect(loaded.map((record) => record.id)).toEqual([good.id]);
    expect(lines).toHaveLength(3);
    for (const path of [danglingDirectory, danglingFile, unreadable]) {
      expect(lines).toContainEqual(
        expect.objectContaining({ level: "error", obj: expect.objectContaining({ path }) }),
      );
    }
  });
});
