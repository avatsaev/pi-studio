/**
 * File explorer & git data hooks — sprint-023 / task-002
 *
 * React Query hooks for directory listing, file content, git status/diff/branches/PR,
 * and git mutations. Drives the Explorer and GitPanel components.
 *
 * See: clean-room-scope/features/file-explorer-transfer.md
 *      clean-room-scope/features/git-checkout.md
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSessionStore } from "../store/session-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  size?: number;
  mtime?: number;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface FileContent {
  path: string;
  text?: string;
  encoding?: "utf8" | "base64";
  isBinary?: boolean;
  size?: number;
  downloadToken?: string;
}

export interface GitStatus {
  cwd: string;
  branch?: string;
  aheadCount?: number;
  behindCount?: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicts: string[];
  isDirty: boolean;
  hasUpstream?: boolean;
}

export interface GitDiff {
  filePath: string;
  hunks: GitHunk[];
  isBinary?: boolean;
  tooLarge?: boolean;
  oldPath?: string;
  newPath?: string;
  kind: "added" | "deleted" | "modified" | "renamed" | "copied";
}

export interface GitHunk {
  header: string;
  lines: GitDiffLine[];
}

export interface GitDiffLine {
  kind: "context" | "added" | "removed";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface GitBranch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  aheadCount?: number;
  behindCount?: number;
  lastCommit?: string;
}

export interface GitAction {
  id: "commit" | "push" | "pull" | "stash" | "stash_pop" | "fetch" | "merge" | "rebase";
  label: string;
  isPrimary?: boolean;
  isDestructive?: boolean;
}

export interface PrActivity {
  id: string;
  kind: "review" | "comment" | "check" | "event";
  author?: string;
  body?: string;
  state?: string;
  createdAt?: number;
  canAttach?: boolean;
  filePath?: string;
  lineNumber?: number;
}

export interface PrInfo {
  number?: number;
  title?: string;
  url?: string;
  state?: "open" | "closed" | "merged";
  activities: PrActivity[];
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const EXPLORER_QUERY_KEYS = {
  directory: (serverId: string, path: string) => ["explorer", "dir", serverId, path] as const,
  fileContent: (serverId: string, path: string) => ["explorer", "file", serverId, path] as const,
  downloadToken: (serverId: string, path: string) => ["explorer", "token", serverId, path] as const,
  gitStatus: (serverId: string, cwd: string) => ["git", "status", serverId, cwd] as const,
  gitDiff: (serverId: string, cwd: string, filePath: string) => ["git", "diff", serverId, cwd, filePath] as const,
  gitBranches: (serverId: string, cwd: string) => ["git", "branches", serverId, cwd] as const,
  gitActions: (serverId: string, cwd: string) => ["git", "actions", serverId, cwd] as const,
  prActivity: (serverId: string, cwd: string) => ["git", "pr", serverId, cwd] as const,
} as const;

// ─── Client type (minimal surface) ───────────────────────────────────────────

interface ExplorerClient {
  connection: {
    request<T>(type: string, payload?: unknown): Promise<T>;
  };
}

// ─── Explorer hooks ───────────────────────────────────────────────────────────

/**
 * Lazily fetch directory children. `enabled` is set to false by default;
 * the Explorer component passes `enabled={isExpanded}`.
 */
export function useDirectoryListing(
  serverId: string | undefined,
  path: string | undefined,
  client: ExplorerClient | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey:
      serverId && path
        ? EXPLORER_QUERY_KEYS.directory(serverId, path)
        : ["explorer", "dir", "__none__"],
    queryFn: async (): Promise<DirectoryListing> => {
      if (!client || !serverId || !path) throw new Error("Missing params");
      // Daemon returns `{ type, result: { ok, kind, path, entries } }`.
      const resp = await client.connection.request<{ result?: unknown; entries?: unknown; path?: string }>(
        "file_explorer_request",
        { serverId, path },
      );
      const result = (resp.result ?? resp) as {
        ok?: boolean;
        error?: string;
        path?: string;
        entries?: { name: string; kind: string; size?: number; mtimeMs?: number }[];
      };
      if (result.ok === false) throw new Error(result.error ?? "Failed to list directory");
      const dir = result.path ?? path;
      const join = (name: string) => (dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`);
      const entries: FileEntry[] = (result.entries ?? []).map((e) => ({
        name: e.name,
        path: join(e.name),
        kind: e.kind === "directory" ? "directory" : e.kind === "symlink" ? "symlink" : "file",
        size: e.size,
        mtime: e.mtimeMs,
      }));
      return { path: dir, entries };
    },
    enabled: !!client && !!serverId && !!path && (options.enabled ?? false),
    staleTime: 30_000,
  });
}

/**
 * Fetch file content for the preview pane.
 */
export function useFileContent(
  serverId: string | undefined,
  path: string | undefined,
  client: ExplorerClient | null,
) {
  return useQuery({
    queryKey:
      serverId && path
        ? EXPLORER_QUERY_KEYS.fileContent(serverId, path)
        : ["explorer", "file", "__none__"],
    queryFn: async (): Promise<FileContent> => {
      if (!client || !serverId || !path) throw new Error("Missing params");
      // Daemon returns `{ type, result: { ok, kind: 'text'|'binary', ... } }`.
      const resp = await client.connection.request<{ result?: unknown }>(
        "file_explorer_request",
        { serverId, path },
      );
      const result = (resp.result ?? resp) as {
        ok?: boolean;
        error?: string;
        kind?: string;
        path?: string;
        content?: string;
        truncated?: boolean;
        metadata?: { size?: number };
        transferToken?: string;
      };
      if (result.ok === false) throw new Error(result.error ?? "Failed to read file");
      if (result.kind === "binary") {
        return {
          path: result.path ?? path,
          isBinary: true,
          size: result.metadata?.size,
          downloadToken: result.transferToken,
        };
      }
      return {
        path: result.path ?? path,
        text: result.content ?? "",
        encoding: "utf8",
        isBinary: false,
        size: result.content?.length,
      };
    },
    enabled: !!client && !!serverId && !!path,
    staleTime: 60_000,
  });
}

/**
 * Request a one-time download token for a file.
 */
export function useDownloadToken(
  serverId: string | undefined,
  path: string | undefined,
  client: ExplorerClient | null,
) {
  return useQuery({
    queryKey:
      serverId && path
        ? EXPLORER_QUERY_KEYS.downloadToken(serverId, path)
        : ["explorer", "token", "__none__"],
    queryFn: async (): Promise<string> => {
      if (!client || !serverId || !path) throw new Error("Missing params");
      const resp = await client.connection.request<{ token: string }>(
        "file_download_token_request",
        { serverId, path },
      );
      return resp.token;
    },
    enabled: !!client && !!serverId && !!path,
    staleTime: 0, // tokens are one-time
    gcTime: 0,
  });
}

// ─── Git hooks ────────────────────────────────────────────────────────────────

export function useGitStatus(
  serverId: string | undefined,
  cwd: string | undefined,
  client: ExplorerClient | null,
) {
  return useQuery({
    queryKey:
      serverId && cwd
        ? EXPLORER_QUERY_KEYS.gitStatus(serverId, cwd)
        : ["git", "status", "__none__"],
    queryFn: async (): Promise<GitStatus> => {
      if (!client || !serverId || !cwd) throw new Error("Missing params");
      const resp = await client.connection.request<GitStatus>(
        "checkout_status_request",
        { serverId, cwd },
      );
      return resp;
    },
    enabled: !!client && !!serverId && !!cwd,
    staleTime: 10_000,
  });
}

export function useGitDiff(
  serverId: string | undefined,
  cwd: string | undefined,
  filePath: string | undefined,
  client: ExplorerClient | null,
) {
  return useQuery({
    queryKey:
      serverId && cwd && filePath
        ? EXPLORER_QUERY_KEYS.gitDiff(serverId, cwd, filePath)
        : ["git", "diff", "__none__"],
    queryFn: async (): Promise<GitDiff> => {
      if (!client || !serverId || !cwd || !filePath) throw new Error("Missing params");
      const resp = await client.connection.request<GitDiff>(
        "checkout_diff_request",
        { serverId, cwd, filePath },
      );
      return resp;
    },
    enabled: !!client && !!serverId && !!cwd && !!filePath,
    staleTime: 5_000,
  });
}

export function useGitBranches(
  serverId: string | undefined,
  cwd: string | undefined,
  client: ExplorerClient | null,
) {
  return useQuery({
    queryKey:
      serverId && cwd
        ? EXPLORER_QUERY_KEYS.gitBranches(serverId, cwd)
        : ["git", "branches", "__none__"],
    queryFn: async (): Promise<GitBranch[]> => {
      if (!client || !serverId || !cwd) throw new Error("Missing params");
      const resp = await client.connection.request<{ branches?: GitBranch[] }>(
        "git_branches_request",
        { serverId, cwd },
      );
      return resp.branches ?? [];
    },
    enabled: !!client && !!serverId && !!cwd,
    staleTime: 20_000,
  });
}

export function usePrActivityQuery(
  serverId: string | undefined,
  cwd: string | undefined,
  client: ExplorerClient | null,
) {
  return useQuery({
    queryKey:
      serverId && cwd
        ? EXPLORER_QUERY_KEYS.prActivity(serverId, cwd)
        : ["git", "pr", "__none__"],
    queryFn: async (): Promise<PrInfo> => {
      if (!client || !serverId || !cwd) throw new Error("Missing params");
      const resp = await client.connection.request<PrInfo>(
        "pull_request_timeline_request",
        { serverId, cwd },
      );
      return resp;
    },
    enabled: !!client && !!serverId && !!cwd,
    staleTime: 30_000,
  });
}

// ─── Git mutations ────────────────────────────────────────────────────────────

export interface CommitInput {
  serverId: string;
  cwd: string;
  message: string;
  files?: string[];
  push?: boolean;
}

export interface CheckoutInput {
  serverId: string;
  cwd: string;
  branch: string;
  create?: boolean;
}

export interface PushInput {
  serverId: string;
  cwd: string;
  remote?: string;
  branch?: string;
}

export interface StashInput {
  serverId: string;
  cwd: string;
  message?: string;
}

export function useGitActions(client: ExplorerClient | null) {
  const qc = useQueryClient();

  const invalidateGit = (serverId: string, cwd: string) => {
    qc.invalidateQueries({ queryKey: ["git", "status", serverId, cwd] });
    qc.invalidateQueries({ queryKey: ["git", "branches", serverId, cwd] });
    qc.invalidateQueries({ queryKey: ["git", "diff", serverId, cwd] });
  };

  const commit = useMutation({
    mutationFn: async (input: CommitInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_commit_request", input);
    },
    onSuccess: (_data, input) => {
      invalidateGit(input.serverId, input.cwd);
    },
  });

  const checkout = useMutation({
    mutationFn: async (input: CheckoutInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_switch_branch_request", input);
    },
    onSuccess: (_data, input) => {
      invalidateGit(input.serverId, input.cwd);
    },
  });

  const push = useMutation({
    mutationFn: async (input: PushInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_push_request", input);
    },
    onSuccess: (_data, input) => {
      invalidateGit(input.serverId, input.cwd);
    },
  });

  const stash = useMutation({
    mutationFn: async (input: StashInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("stash_save_request", input);
    },
    onSuccess: (_data, input) => {
      invalidateGit(input.serverId, input.cwd);
    },
  });

  const stashPop = useMutation({
    mutationFn: async (input: StashInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("stash_pop_request", input);
    },
    onSuccess: (_data, input) => {
      invalidateGit(input.serverId, input.cwd);
    },
  });

  const pull = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_pull_request", input);
    },
    onSuccess: (_data, input) => invalidateGit(input.serverId, input.cwd),
  });

  const fetch = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_fetch_request", input);
    },
    onSuccess: (_data, input) => invalidateGit(input.serverId, input.cwd),
  });

  const createBranch = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string; name: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_create_branch_request", input);
    },
    onSuccess: (_data, input) => invalidateGit(input.serverId, input.cwd),
  });

  const deleteBranch = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string; name: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_delete_branch_request", input);
    },
    onSuccess: (_data, input) => invalidateGit(input.serverId, input.cwd),
  });

  const suggestCommitMessage = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string }): Promise<string> => {
      if (!client) throw new Error("No client");
      const resp = await client.connection.request<{ message?: string }>(
        "checkout_suggest_commit_message_request",
        input,
      );
      return resp.message ?? "";
    },
  });

  const resolveConflict = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string; path: string; resolution: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("checkout_resolve_conflict_request", input);
    },
    onSuccess: (_data, input) => invalidateGit(input.serverId, input.cwd),
  });

  const deleteWorktree = useMutation({
    mutationFn: async (input: { serverId: string; cwd: string }) => {
      if (!client) throw new Error("No client");
      return client.connection.request("git_worktree_delete_request", input);
    },
    onSuccess: (_data, input) => invalidateGit(input.serverId, input.cwd),
  });

  return {
    commit,
    checkout,
    push,
    stash,
    stashPop,
    pull,
    fetch,
    createBranch,
    deleteBranch,
    suggestCommitMessage,
    resolveConflict,
    deleteWorktree,
  };
}

// ─── Cache invalidation on file-write events ─────────────────────────────────

/**
 * Subscribe to file-write agent stream events and invalidate the explorer/git
 * caches for the affected workspace. Call from the connection provider.
 */
export function subscribeFileWriteInvalidation(
  client: {
    connection: { onSessionMessage(handler: (msg: unknown) => void): () => void };
  },
  queryClient: ReturnType<typeof useQueryClient>,
): () => void {
  return client.connection.onSessionMessage((rawMsg: unknown) => {
    const msg = rawMsg as Record<string, unknown>;
    if (msg["type"] === "agent_stream") {
      const event = msg["event"] as Record<string, unknown> | undefined;
      if (event?.["type"] === "tool_call") {
        const detail = event?.["detail"] as Record<string, unknown> | undefined;
        const kind = detail?.["kind"] as string | undefined;
        if (kind === "edit" || kind === "write") {
          // Invalidate all git status and explorer queries (conservative)
          queryClient.invalidateQueries({ queryKey: ["git", "status"] });
          queryClient.invalidateQueries({ queryKey: ["explorer", "dir"] });
        }
      }
    }
  });
}
