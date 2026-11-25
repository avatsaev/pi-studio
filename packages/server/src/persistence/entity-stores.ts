import { existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { Logger } from "../logging/logger.js";
import { atomicWriteJson, loadStore, quarantineFile } from "./atomic-store.js";
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
  logger: Logger,
): Promise<AgentRecord | null> {
  return loadStore(agentFilePath(home, cwd, id), agentRecordSchema.nullable(), null, logger);
}

/** Delete an agent's persisted record file. Returns true if it existed. */
export async function deleteAgent(home: string, cwd: string, id: string): Promise<boolean> {
  const path = agentFilePath(home, cwd, id);
  if (!existsSync(path)) return false;
  await rm(path, { force: true });
  return true;
}

/**
 * Load every persisted agent record across all `agents/{sanitized-cwd}/` directories. A damaged
 * record is set aside and logged by {@link loadStore}; an entry that cannot be read (a dangling
 * symlink, permissions, a directory called `x.json`) is logged and skipped. The others load.
 */
export async function loadAllAgents(home: string, logger: Logger): Promise<AgentRecord[]> {
  const base = join(home, "agents");
  if (!existsSync(base)) return [];
  const records: AgentRecord[] = [];
  for (const entry of readdirSync(base)) {
    const dir = join(base, entry);
    let files: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logger.error({ path: dir, err }, "agent directory skipped");
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
      if (!existsSync(path)) {
        logger.error({ path }, "agent record skipped: dangling symlink");
        continue;
      }
      try {
        const record = await loadStore(path, agentRecordSchema.nullable(), null, logger);
        if (record) records.push(record);
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        logger.error({ path, err }, "agent record skipped");
      }
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

/** The invalid records a {@link loadRegistry} names in its log line. */
const MAX_DESCRIBED_RECORDS = 3;

/**
 * Load a registry file (an array of records). A record that fails `schema.element` costs only that
 * record: the original file is set aside ({@link quarantineFile}, logged with the number dropped)
 * and the valid records are written back, so the next save cannot lose them. A file that is not
 * JSON or not an array is set aside by {@link loadStore} and the registry starts empty.
 */
async function loadRegistry<S extends z.ZodTypeAny>(
  path: string,
  schema: z.ZodArray<S>,
  logger: Logger,
): Promise<Array<z.output<S>>> {
  const items = await loadStore(path, z.array(z.unknown()), [], logger);
  const valid: Array<z.output<S>> = [];
  const invalid: string[] = [];
  items.forEach((item, index) => {
    const parsed = schema.element.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    invalid.push(`[${index}] ${issue?.path.join(".") || "(record)"}: ${issue?.message}`);
  });
  if (invalid.length === 0) return valid;

  const shown = invalid.slice(0, MAX_DESCRIBED_RECORDS).join("; ");
  const more = invalid.length - MAX_DESCRIBED_RECORDS;
  await quarantineFile(
    path,
    `${invalid.length} of ${items.length} records invalid: ${shown}${more > 0 ? `; and ${more} more` : ""}`,
    logger,
  );
  await atomicWriteJson(path, valid as Array<z.input<S>>, schema);
  return valid;
}

export async function loadProjects(home: string, logger: Logger): Promise<ProjectRegistry> {
  return loadRegistry(projectsPath(home), projectRegistrySchema, logger);
}

export async function saveProjects(home: string, projects: ProjectRegistry): Promise<void> {
  await atomicWriteJson(projectsPath(home), projects, projectRegistrySchema);
}

export async function loadWorkspaces(home: string, logger: Logger): Promise<WorkspaceRegistry> {
  return loadRegistry(workspacesPath(home), workspaceRegistrySchema, logger);
}

export async function saveWorkspaces(home: string, workspaces: WorkspaceRegistry): Promise<void> {
  await atomicWriteJson(workspacesPath(home), workspaces, workspaceRegistrySchema);
}
