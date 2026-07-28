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
  explorer: (path: string) => ["explorer", path] as const,
  agentList: () => ["agents", "list"] as const,
  providerModels: (provider: string) => ["providers", "models", provider] as const,
  agentTimeline: (agentId: string) => ["agents", "timeline", agentId] as const,
  agentCommands: (sessionId: string) => ["agents", "commands", sessionId] as const,
};
