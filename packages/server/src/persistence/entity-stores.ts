import { existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { z } from "zod";

import { atomicWriteJson, loadStore } from "./atomic-store.js";
import {
  type AgentRecord,
  agentRecordSchema,
  type ProjectRegistry,
  projectRegistrySchema,
  type WorkspaceRegistry,
  workspaceRegistrySchema,
} from "./entity-schemas.js";

/** File-backed accessors for every persisted daemon entity. Records write atomically and load to `null` when absent. */

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

/** Delete an agent's persisted record file. Returns true if it existed. */
export async function deleteAgent(home: string, cwd: string, id: string): Promise<boolean> {
  const path = agentFilePath(home, cwd, id);
  if (!existsSync(path)) return false;
  await rm(path, { force: true });
  return true;
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
