import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureDirectoryLayout } from "./atomic-store.js";
import type { AgentRecord, Schedule } from "./entity-schemas.js";
import {
  agentFilePath,
  createLoopStore,
  loadAgent,
  loadLoops,
  loadProjects,
  loadSchedule,
  loadWorkspaces,
  loopStorePath,
  sanitizeCwd,
  saveAgent,
  saveProjects,
  saveSchedule,
  saveWorkspaces,
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
    timeline: [],
  };

  it("persists to agents/{sanitized-cwd}/{id}.json and round-trips through Zod", async () => {
    const home = await tempHome();
    await saveAgent(home, agent);
    const path = agentFilePath(home, agent.cwd, agent.id);
    expect(path).toContain(join("agents", "home-user-project", `${agent.id}.json`));
    expect(existsSync(path)).toBe(true);
    const loaded = await loadAgent(home, agent.cwd, agent.id);
    expect(loaded).toEqual(agent);
  });

  it("tolerates unknown/optional fields on load", async () => {
    const home = await tempHome();
    await saveAgent(home, agent);
    const path = agentFilePath(home, agent.cwd, agent.id);
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    onDisk.futureField = { added: "later" };
    await writeFile(path, JSON.stringify(onDisk), "utf8");
    const loaded = await loadAgent(home, agent.cwd, agent.id);
    expect((loaded as Record<string, unknown>).futureField).toEqual({ added: "later" });
  });

  it("returns null for a missing agent", async () => {
    const home = await tempHome();
    expect(await loadAgent(home, "/nope", randomUUID())).toBeNull();
  });
});

describe("schedule store", () => {
  it("round-trips a schedule keyed by 8-hex id", async () => {
    const home = await tempHome();
    const schedule: Schedule = {
      id: "a1b2c3d4",
      prompt: "daily standup",
      cadence: { type: "every", everyMs: 86_400_000 },
      target: { type: "new-agent", config: { provider: "pi", cwd: "/work" } },
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
      runs: [],
    };
    await saveSchedule(home, schedule);
    expect(await loadSchedule(home, schedule.id)).toEqual(schedule);
  });
});

describe("loop store (queued non-atomic)", () => {
  it("saves via the queued writer and loads the array", async () => {
    const home = await tempHome();
    const store = createLoopStore(home);
    const loops = [
      {
        id: "loop0001",
        prompt: "iterate",
        cwd: "/work",
        provider: "pi",
        verifyChecks: [],
        status: "running" as const,
        createdAt: NOW,
        iterations: [],
        logs: [],
        nextLogSeq: 0,
      },
    ];
    await store.save(loops);
    expect(existsSync(loopStorePath(home))).toBe(true);
    const loaded = await loadLoops(home);
    expect(loaded[0]?.id).toBe("loop0001");
    expect(loaded[0]?.status).toBe("running");
  });

  it("serializes concurrent saves in order (last wins)", async () => {
    const home = await tempHome();
    const store = createLoopStore(home);
    const mk = (id: string, status: "running" | "stopped") => [
      {
        id,
        prompt: "p",
        cwd: "/w",
        provider: "pi",
        verifyChecks: [],
        status,
        createdAt: NOW,
        iterations: [],
        logs: [],
        nextLogSeq: 0,
      },
    ];
    await Promise.all([
      store.save(mk("aaaaaaaa", "running")),
      store.save(mk("bbbbbbbb", "stopped")),
    ]);
    const loaded = await loadLoops(home);
    expect(loaded[0]?.id).toBe("bbbbbbbb");
  });
});

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

    const projects = await loadProjects(home);
    const workspaces = await loadWorkspaces(home);
    expect(projects[0]?.archivedAt).toBeNull();
    expect(workspaces[0]?.archivedAt).toBe("2026-06-11T13:00:00.000Z");
  });

  it("default to empty arrays when missing", async () => {
    const home = await tempHome();
    expect(await loadProjects(home)).toEqual([]);
    expect(await loadWorkspaces(home)).toEqual([]);
  });
});
