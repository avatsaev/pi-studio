// Per-client workspace layout store abstraction.
// clean-room-scope/features/workspace-ui.md § Data & Persistence

import { defaultWorkspaceLayout, type SplitNode, type WorkspaceLayout } from "./layout.js";

export type PersistedWorkspaceLayout = {
  version: 1;
  root: SplitNode;
  focusedPaneId: string;
};

export type LayoutStorage = {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
};

export function workspacePersistenceKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

export function createMemoryLayoutStorage(seed: Record<string, string> = {}): LayoutStorage & { dump(): Record<string, string> } {
  const data = { ...seed };
  return {
    getItem: (key) => data[key],
    setItem: (key, value) => { data[key] = value; },
    dump: () => ({ ...data }),
  };
}

export function serializeLayout(layout: WorkspaceLayout): string {
  const persisted: PersistedWorkspaceLayout = { version: 1, root: layout.root, focusedPaneId: layout.focusedPaneId };
  return JSON.stringify(persisted);
}

export function deserializeLayout(value: string | null | undefined): WorkspaceLayout {
  if (!value) return defaultWorkspaceLayout();
  try {
    const parsed = JSON.parse(value) as Partial<PersistedWorkspaceLayout>;
    if (parsed.version !== 1 || !parsed.root || !parsed.focusedPaneId) return defaultWorkspaceLayout();
    return { root: parsed.root, focusedPaneId: parsed.focusedPaneId, parentTabId: {} };
  } catch {
    return defaultWorkspaceLayout();
  }
}

export class WorkspaceLayoutStore {
  constructor(private readonly storage: LayoutStorage) {}

  load(serverId: string, workspaceId: string): WorkspaceLayout {
    return deserializeLayout(this.storage.getItem(workspacePersistenceKey(serverId, workspaceId)));
  }

  save(serverId: string, workspaceId: string, layout: WorkspaceLayout): void {
    this.storage.setItem(workspacePersistenceKey(serverId, workspaceId), serializeLayout(layout));
  }
}
