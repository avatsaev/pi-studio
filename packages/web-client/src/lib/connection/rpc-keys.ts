/**
 * TanStack Query key factory — one namespaced key builder per RPC domain so cache
 * invalidation (e.g. the `filesChanged` signal, POC_TO_APP_PLAN_UI.md §4.5) targets exactly
 * the affected queries.
 */

export const rpcKeys = {
  fileRead: (path: string) => ["file", "read", path] as const,
  fileDownload: (path: string) => ["file", "download", path] as const,
  fileText: (path: string, objectUrl: string | null) => ["file", "text", path, objectUrl] as const,
  fileDiff: (path: string, cwd: string, staged: boolean) =>
    ["file", "diff", path, cwd, staged] as const,
  /** Invalidation prefix covering every (cwd, staged) variant of `fileDiff` for one path. */
  fileDiffByPath: (path: string) => ["file", "diff", path] as const,
  /** HTML preview's inlined-asset bundle (sprint-064), keyed on the document's own content hash
   *  so it refetches when the file changes and not on an unrelated re-render; Preview/Source and
   *  the network-policy toggle deliberately don't appear in the key. */
  htmlAssetBundle: (path: string, contentHash: string) =>
    ["file", "htmlAssets", path, contentHash] as const,
  /** Invalidation prefix covering every content-hash variant of `htmlAssetBundle` for one path —
   *  Reload uses this so it forces a refetch even when the document's own hash is unchanged (an
   *  edited *asset*, not the document itself, per the spec's documented limitation). */
  htmlAssetBundleByPath: (path: string) => ["file", "htmlAssets", path] as const,
  explorer: (path: string) => ["explorer", path] as const,
  agentList: () => ["agents", "list"] as const,
  providerModels: (provider: string) => ["providers", "models", provider] as const,
  agentTimeline: (agentId: string) => ["agents", "timeline", agentId] as const,
  /** sprint-070: live session's thinking levels (`agent_thinking_levels_request`), keyed on the
   *  model so a model change refetches automatically on the next open. */
  thinkingLevels: (agentId: string, model: string | undefined) =>
    ["agents", "thinkingLevels", agentId, model ?? ""] as const,
  agentCommands: (sessionId: string) => ["agents", "commands", sessionId] as const,
  /** sprint-065: `listProviderAuth()` result — invalidated after a login (task-004) or logout. */
  providerAuthList: () => ["providers", "auth", "list"] as const,
};
