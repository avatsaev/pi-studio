import type { ProjectRecord, WorkspaceRecord } from "../persistence/entity-schemas.js";
import {
  loadProjects,
  loadWorkspaces,
  saveProjects,
  saveWorkspaces,
} from "../persistence/entity-stores.js";
import { normalizePath } from "./workspace-registry.js";

/**
 * Startup reconciliation (features/projects-workspaces.md § Startup reconciliation).
 *
 * Duplicate projects keyed on the same normalized `rootPath` are merged onto a single canonical
 * project: workspaces are migrated onto it (remote-keyed ids preferred), and emptied duplicate
 * projects are archived.
 */

export interface ReconciliationResult {
  /** projectIds that were archived as emptied duplicates. */
  archivedProjectIds: string[];
  /** workspaceIds whose projectId was migrated to a canonical project. */
  migratedWorkspaceIds: string[];
}

/** Remote-keyed ids (`remote:...`) are canonical over path-keyed ids (`path:...`). */
function isRemoteKeyed(project: ProjectRecord): boolean {
  return project.projectId.startsWith("remote:");
}

/** Pick the canonical project from a same-rootPath group: prefer remote-keyed, then oldest. */
function pickCanonical(group: ProjectRecord[]): ProjectRecord {
  const remoteKeyed = group.filter(isRemoteKeyed);
  const pool = remoteKeyed.length > 0 ? remoteKeyed : group;
  return pool.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0] as ProjectRecord;
}

export async function reconcileRegistries(home: string): Promise<ReconciliationResult> {
  const projects = await loadProjects(home);
  const workspaces = await loadWorkspaces(home);
  const result: ReconciliationResult = { archivedProjectIds: [], migratedWorkspaceIds: [] };

  const active = projects.filter((p) => !p.archivedAt);

  // Group active projects by normalized rootPath.
  const groups = new Map<string, ProjectRecord[]>();
  for (const project of active) {
    const key = normalizePath(project.rootPath);
    const list = groups.get(key);
    if (list) list.push(project);
    else groups.set(key, [project]);
  }

  const now = new Date().toISOString();
  let projectsDirty = false;
  let workspacesDirty = false;

  for (const group of groups.values()) {
    if (group.length < 2) continue; // no duplicates
    const canonical = pickCanonical(group);
    const duplicates = group.filter((p) => p.projectId !== canonical.projectId);
    const duplicateIds = new Set(duplicates.map((p) => p.projectId));

    // Migrate the duplicates' active workspaces onto the canonical project.
    for (const ws of workspaces) {
      if (!ws.archivedAt && duplicateIds.has(ws.projectId)) {
        ws.projectId = canonical.projectId;
        ws.updatedAt = now;
        result.migratedWorkspaceIds.push(ws.workspaceId);
        workspacesDirty = true;
      }
    }

    // Archive the now-emptied duplicate projects.
    for (const dup of duplicates) {
      const stillHasActive = workspaces.some(
        (w: WorkspaceRecord) => !w.archivedAt && w.projectId === dup.projectId,
      );
      if (!stillHasActive) {
        dup.archivedAt = now;
        dup.updatedAt = now;
        result.archivedProjectIds.push(dup.projectId);
        projectsDirty = true;
      }
    }
  }

  if (workspacesDirty) await saveWorkspaces(home, workspaces);
  if (projectsDirty) await saveProjects(home, projects);
  return result;
}
