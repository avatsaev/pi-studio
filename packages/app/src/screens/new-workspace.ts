// New-workspace creation flow model.
// app-navigation-screens.md § New-workspace, projects-workspaces.md, worktrees.md

import { parseOpenIntent, routes } from "../runtime/route-grammar.js";

export type NewWorkspaceParams = {
  serverId?: string;
  dir?: string;
  name?: string;
  projectId?: string;
  draftId?: string;
};

export function parseNewWorkspaceParams(pathOrQuery: string): NewWorkspaceParams {
  const query = pathOrQuery.includes("?") ? pathOrQuery.slice(pathOrQuery.indexOf("?") + 1) : pathOrQuery.replace(/^\?/, "");
  const params = new URLSearchParams(query);
  return {
    serverId: params.get("serverId") ?? undefined,
    dir: params.get("dir") ?? undefined,
    name: params.get("name") ?? undefined,
    projectId: params.get("projectId") ?? undefined,
    draftId: params.get("draftId") ?? undefined,
  };
}

export type ProjectPickerItem = {
  projectId: string;
  projectKey: string;
  name: string;
  worktreeCapable: boolean;
};

export function worktreeCapableProjects(projects: readonly ProjectPickerItem[]): ProjectPickerItem[] {
  return projects.filter((p) => p.worktreeCapable);
}

export type RefPickerItem = {
  id: string;
  label: string;
  kind: "branch" | "github-pr";
};

export function filterRefs(refs: readonly RefPickerItem[], query: string): RefPickerItem[] {
  if (query.trim() === "") return [...refs];
  const q = query.toLowerCase();
  return refs.filter((r) => r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
}

export type CreateAgentPreferences = {
  provider?: string;
  providerPreferences?: Record<string, {
    model?: string;
    mode?: string;
    thinkingByModel?: Record<string, string>;
    featureValues?: Record<string, unknown>;
  }>;
  favoriteModels?: { provider: string; modelId: string }[];
  isolation?: "local" | "worktree";
};

export type AgentDefaults = {
  provider?: string;
  model?: string;
  mode?: string;
  thinking?: string;
  featureValues?: Record<string, unknown>;
  favoriteModels: { provider: string; modelId: string }[];
  isolation: "local" | "worktree";
};

export function createAgentDefaults(preferences: CreateAgentPreferences | undefined): AgentDefaults {
  const provider = preferences?.provider;
  const providerPrefs = provider ? preferences?.providerPreferences?.[provider] : undefined;
  const model = providerPrefs?.model;
  return {
    provider,
    model,
    mode: providerPrefs?.mode,
    thinking: model ? providerPrefs?.thinkingByModel?.[model] : undefined,
    featureValues: providerPrefs?.featureValues,
    favoriteModels: preferences?.favoriteModels ?? [],
    isolation: preferences?.isolation ?? "worktree",
  };
}

export type NewWorkspaceClient = {
  createEmptyWorktree(input: { serverId: string; projectId?: string; name?: string; dir?: string; refId?: string }): Promise<{ workspaceId: string }>;
  ensureWorktree(input: { serverId: string; projectId?: string; name?: string; dir?: string; refId?: string }): Promise<{ workspaceId: string }>;
  stagePendingDraft(input: { serverId: string; workspaceId: string; text: string; attachments?: readonly string[] }): Promise<{ draftId: string }>;
};

export type SubmitNewWorkspaceInput = {
  params: NewWorkspaceParams;
  client: NewWorkspaceClient;
  text: string;
  attachments?: readonly string[];
  refId?: string;
};

export type SubmitNewWorkspaceResult =
  | { ok: true; workspaceId: string; draftId?: string; route: string }
  | { ok: false; error: string };

export async function submitNewWorkspace(input: SubmitNewWorkspaceInput): Promise<SubmitNewWorkspaceResult> {
  const { serverId } = input.params;
  if (!serverId) return { ok: false, error: "Missing serverId query parameter" };
  const text = input.text.trim();
  const hasAttachments = (input.attachments?.length ?? 0) > 0;

  try {
    if (!text && !hasAttachments) {
      const worktree = await input.client.createEmptyWorktree({
        serverId,
        projectId: input.params.projectId,
        name: input.params.name,
        dir: input.params.dir,
        refId: input.refId,
      });
      return { ok: true, workspaceId: worktree.workspaceId, route: routes.workspace(serverId, worktree.workspaceId) };
    }

    const worktree = await input.client.ensureWorktree({
      serverId,
      projectId: input.params.projectId,
      name: input.params.name,
      dir: input.params.dir,
      refId: input.refId,
    });
    const draft = await input.client.stagePendingDraft({
      serverId,
      workspaceId: worktree.workspaceId,
      text,
      attachments: input.attachments,
    });
    return {
      ok: true,
      workspaceId: worktree.workspaceId,
      draftId: draft.draftId,
      route: routes.workspace(serverId, worktree.workspaceId, { kind: "draft", id: draft.draftId }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function newWorkspaceInitialDraft(params: NewWorkspaceParams): { draftId?: string; openIntent: ReturnType<typeof parseOpenIntent> } {
  return { draftId: params.draftId, openIntent: params.draftId ? { kind: "draft", id: params.draftId } : null };
}
