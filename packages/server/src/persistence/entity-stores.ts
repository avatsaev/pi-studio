import { existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { z } from "zod";

import { atomicWriteJson, createQueuedJsonWriter, loadStore } from "./atomic-store.js";
import {
  type AgentRecord,
  agentRecordSchema,
  type ChatStore,
  chatStoreSchema,
  type LoopStore,
  loopStoreSchema,
  type ProjectRegistry,
  projectRegistrySchema,
  type Schedule,
  scheduleSchema,
  type WorkspaceRegistry,
  workspaceRegistrySchema,
} from "./entity-schemas.js";

/**
 * File-backed accessors for every persisted daemon entity. Single-record stores (agent, schedule)
 * write atomically and load to `null` when absent; the loop store uses the queued non-atomic writer.
 */

/**
 * Derive an agent's on-disk directory key from its `cwd`: strip the filesystem root and replace path
 * separators with `-`. A Windows drive letter becomes a `C-`-style prefix
 * (architecture/persistence.md). The result is stable and directory-safe.
 */
export function sanitizeCwd(cwd: string): string {
  let rest = cwd.trim();
  let prefix = "";

  const drive = rest.match(/^([A-Za-z]):[\\/]/);
  if (drive) {
    prefix = `${(drive[1] as string).toUpperCase()}-`;
    rest = rest.slice(drive[0].length);
  } else {
    rest = rest.replace(/^[\\/]+/, ""); // strip leading POSIX root
  }

  const body = rest.replace(/[\\/]+/g, "-").replace(/^-+|-+$/g, "");
  return `${prefix}${body}`;
}

/** Generic loader returning the parsed entity or `null` when the file is missing/corrupt. */
async function loadEntityOrNull<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
): Promise<z.infer<S> | null> {
  if (!existsSync(path)) return null;
  return loadStore(path, schema.nullable(), null);
}

// ---------------------------------------------------------------------------
// Agent records  →  agents/{sanitized-cwd}/{id}.json
// ---------------------------------------------------------------------------

export function agentDirectory(home: string, cwd: string): string {
  return join(home, "agents", sanitizeCwd(cwd));
}

export function agentFilePath(home: string, cwd: string, id: string): string {
  return join(agentDirectory(home, cwd), `${id}.json`);
}

export async function saveAgent(home: string, agent: AgentRecord): Promise<void> {
  await atomicWriteJson(agentFilePath(home, agent.cwd, agent.id), agent, agentRecordSchema);
}

export async function loadAgent(
  home: string,
  cwd: string,
  id: string,
): Promise<AgentRecord | null> {
  return loadEntityOrNull(agentFilePath(home, cwd, id), agentRecordSchema);
}

/** Load every persisted agent record across all `agents/{sanitized-cwd}/` directories. */
export async function loadAllAgents(home: string): Promise<AgentRecord[]> {
  const base = join(home, "agents");
  if (!existsSync(base)) return [];
  const records: AgentRecord[] = [];
  for (const entry of readdirSync(base)) {
    const dir = join(base, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const record = await loadEntityOrNull(join(dir, file), agentRecordSchema);
      if (record) records.push(record);
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Schedules  →  schedules/{id}.json
// ---------------------------------------------------------------------------

export function scheduleFilePath(home: string, id: string): string {
  return join(home, "schedules", `${id}.json`);
}

export async function saveSchedule(home: string, schedule: Schedule): Promise<void> {
  await atomicWriteJson(scheduleFilePath(home, schedule.id), schedule, scheduleSchema);
}

export async function loadSchedule(home: string, id: string): Promise<Schedule | null> {
  return loadEntityOrNull(scheduleFilePath(home, id), scheduleSchema);
}

/** Load every persisted schedule (enumerates `schedules/*.json`). Skips missing/corrupt files. */
export async function loadAllSchedules(home: string): Promise<Schedule[]> {
  const dir = join(home, "schedules");
  if (!existsSync(dir)) return [];
  const schedules: Schedule[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    const schedule = await loadSchedule(home, id);
    if (schedule) schedules.push(schedule);
  }
  return schedules;
}

/** Delete a schedule file. Returns true if it existed. */
export async function deleteSchedule(home: string, id: string): Promise<boolean> {
  const path = scheduleFilePath(home, id);
  if (!existsSync(path)) return false;
  await rm(path, { force: true });
  return true;
}

// ---------------------------------------------------------------------------
// Loops  →  loops/loops.json   (non-atomic, queued)
// ---------------------------------------------------------------------------

export function loopStorePath(home: string): string {
  return join(home, "loops", "loops.json");
}

export async function loadLoops(home: string): Promise<LoopStore> {
  return loadStore(loopStorePath(home), loopStoreSchema, []);
}

/**
 * Open the loop store. Reads load the array; writes go through a single queued non-atomic writer so
 * concurrent saves serialize in order (architecture/persistence.md — loop store is plain + queued).
 */
export function createLoopStore(home: string): {
  load: () => Promise<LoopStore>;
  save: (loops: LoopStore) => Promise<void>;
} {
  const write = createQueuedJsonWriter();
  return {
    load: () => loadLoops(home),
    save: (loops: LoopStore) => write(loopStorePath(home), loops, loopStoreSchema),
  };
}

// ---------------------------------------------------------------------------
// Chat  →  chat/rooms.json
// ---------------------------------------------------------------------------

export function chatStorePath(home: string): string {
  return join(home, "chat", "rooms.json");
}

export async function loadChat(home: string): Promise<ChatStore> {
  return loadStore(chatStorePath(home), chatStoreSchema, { rooms: [], messages: [] });
}

export async function saveChat(home: string, chat: ChatStore): Promise<void> {
  await atomicWriteJson(chatStorePath(home), chat, chatStoreSchema);
}

// ---------------------------------------------------------------------------
// Project + workspace registries  →  projects/{projects,workspaces}.json
// ---------------------------------------------------------------------------

export function projectsPath(home: string): string {
  return join(home, "projects", "projects.json");
}

export function workspacesPath(home: string): string {
  return join(home, "projects", "workspaces.json");
}

export async function loadProjects(home: string): Promise<ProjectRegistry> {
  return loadStore(projectsPath(home), projectRegistrySchema, []);
}

export async function saveProjects(home: string, projects: ProjectRegistry): Promise<void> {
  await atomicWriteJson(projectsPath(home), projects, projectRegistrySchema);
}

export async function loadWorkspaces(home: string): Promise<WorkspaceRegistry> {
  return loadStore(workspacesPath(home), workspaceRegistrySchema, []);
}

export async function saveWorkspaces(home: string, workspaces: WorkspaceRegistry): Promise<void> {
  await atomicWriteJson(workspacesPath(home), workspaces, workspaceRegistrySchema);
}
