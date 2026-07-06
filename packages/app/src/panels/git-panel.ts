// Git panel view model: changes, diff, git actions, PR surface.
// clean-room-scope/features/feature-panels-ui.md § Git: changes / diff / PR

// ─── Changes list ─────────────────────────────────────────────────────────

export type FileChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
export type StagingState = "staged" | "unstaged" | "untracked";

export type FileChange = {
  path: string;
  status: FileChangeStatus;
  staging: StagingState;
  added: number;
  deleted: number;
};

export type ChangesGroup = {
  label: "Staged" | "Unstaged" | "Untracked";
  staging: StagingState;
  files: FileChange[];
};

export function groupChanges(files: readonly FileChange[]): ChangesGroup[] {
  const staged = files.filter((f) => f.staging === "staged");
  const unstaged = files.filter((f) => f.staging === "unstaged");
  const untracked = files.filter((f) => f.staging === "untracked");
  const groups: ChangesGroup[] = [];
  if (staged.length) groups.push({ label: "Staged", staging: "staged", files: staged });
  if (unstaged.length) groups.push({ label: "Unstaged", staging: "unstaged", files: unstaged });
  if (untracked.length) groups.push({ label: "Untracked", staging: "untracked", files: untracked });
  return groups;
}

export function isDirty(groups: ChangesGroup[]): boolean {
  return groups.some((g) => g.files.length > 0);
}

// ─── Commit box ───────────────────────────────────────────────────────────

export type CommitBoxState = {
  message: string;
  suggestingMessage: boolean;
  committing: boolean;
  pushing: boolean;
  lastError?: string;
};

export const INITIAL_COMMIT_BOX: CommitBoxState = { message: "", suggestingMessage: false, committing: false, pushing: false };

export function canCommit(box: CommitBoxState, groups: ChangesGroup[]): boolean {
  return box.message.trim().length > 0 && groups.some((g) => g.staging === "staged" && g.files.length > 0);
}

// ─── Diff mode / view state ────────────────────────────────────────────────

export type DiffMode = "uncommitted" | "committed";
export type DiffLayout = "unified" | "split";

export type DiffSidebarState = {
  diffMode: DiffMode;
  diffLayout: DiffLayout;
  hideWhitespace: boolean;
  selectedFilePath?: string;
  expandedFilePaths: Set<string>;
  loading: boolean;
  isGitRepo: boolean;
};

export const INITIAL_DIFF_STATE: DiffSidebarState = {
  diffMode: "uncommitted",
  diffLayout: "unified",
  hideWhitespace: false,
  expandedFilePaths: new Set(),
  loading: false,
  isGitRepo: true,
};

export type DiffFileEntry = {
  path: string;
  baseName: string;
  dirName: string;
  isNew: boolean;
  isDeleted: boolean;
  status: "ok" | "binary" | "too_large";
  added: number;
  deleted: number;
  /** Git change status for the sidebar badge (A/M/D/U/C). Optional; derived from live status. */
  changeStatus?: FileChangeStatus;
};

/** Live git status shape (subset of the daemon `checkout_status` response). */
export type GitStatusFiles = {
  staged?: readonly string[];
  unstaged?: readonly string[];
  untracked?: readonly string[];
  conflicts?: readonly string[];
};

/**
 * Map a live git status into the changed-file list rendered by the Git pane.
 * Precedence per path: conflict > deleted(unstaged) > untracked(new) > modified.
 * Pure + unit-tested.
 */
export function gitStatusToDiffFiles(status: GitStatusFiles): DiffFileEntry[] {
  const byPath = new Map<string, FileChangeStatus>();
  const set = (path: string, s: FileChangeStatus) => {
    if (!byPath.has(path)) byPath.set(path, s);
  };
  for (const p of status.conflicts ?? []) set(p, "conflict");
  for (const p of status.untracked ?? []) set(p, "untracked");
  for (const p of status.staged ?? []) set(p, "modified");
  for (const p of status.unstaged ?? []) set(p, "modified");

  return [...byPath.entries()]
    .map(([path, changeStatus]) => {
      const segs = path.split("/").filter(Boolean);
      const baseName = segs.at(-1) ?? path;
      const dirName = segs.slice(0, -1).join("/");
      return {
        path,
        baseName,
        dirName,
        isNew: changeStatus === "untracked" || changeStatus === "added",
        isDeleted: changeStatus === "deleted",
        status: "ok" as const,
        added: 0,
        deleted: 0,
        changeStatus,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Single-letter badge for a file change status (A/M/D/U/C). */
export function fileChangeBadge(status: FileChangeStatus | undefined): string {
  switch (status) {
    case "added": return "A";
    case "modified": return "M";
    case "deleted": return "D";
    case "renamed": return "R";
    case "untracked": return "U";
    case "conflict": return "C";
    default: return "•";
  }
}

export type DiffViewEmptyReason =
  | "whitespace-hidden"
  | "uncommitted"
  | "committed"
  | "loading"
  | "not-git";

export function diffViewEmptyReason(state: DiffSidebarState, fileCount: number): DiffViewEmptyReason | null {
  if (!state.isGitRepo) return "not-git";
  if (state.loading) return "loading";
  if (fileCount > 0) return null;
  if (state.hideWhitespace) return "whitespace-hidden";
  return state.diffMode === "uncommitted" ? "uncommitted" : "committed";
}

export function diffEmptyMessage(reason: DiffViewEmptyReason): string {
  switch (reason) {
    case "whitespace-hidden": return "No visible changes after hiding whitespace";
    case "uncommitted": return "No uncommitted changes";
    case "committed": return "No changes vs base";
    case "loading": return "Checking repository…";
    case "not-git": return "Not a git repository";
  }
}

// ─── Git actions ──────────────────────────────────────────────────────────

export type GitActionId =
  | "commit"
  | "pull"
  | "push"
  | "pull-and-push"
  | "pr"
  | "merge-pr-squash"
  | "merge-pr-merge"
  | "merge-pr-rebase"
  | "enable-pr-auto-merge"
  | "disable-pr-auto-merge"
  | "merge-branch"
  | "merge-from-base"
  | "archive-worktree"
  | "view-pr";

export type GitActionStatus = "idle" | "pending" | "success" | "error";

export type GitAction = {
  id: GitActionId;
  label: string;
  pendingLabel: string;
  successLabel: string;
  disabled: boolean;
  status: GitActionStatus;
  unavailableMessage?: string;
  icon: string;
};

export type GitActionsCluster = {
  primary: GitAction;
  secondary: GitAction[];
  menu: GitAction[];
};

export type GitActionContext = {
  isDirty: boolean;
  isBehind: boolean;
  isWorktree: boolean;
  hasPr: boolean;
  prMergeable?: boolean;
  prAutoMergeEnabled?: boolean;
  hasBase: boolean;
  committing: boolean;
  pushing: boolean;
};

export function buildGitActions(ctx: GitActionContext): GitActionsCluster {
  const allActions: GitAction[] = [
    action("archive-worktree", "Archive worktree", "Archiving…", "Archived", ctx.isWorktree),
    action("commit", "Commit", "Committing…", "Committed", ctx.isDirty && !ctx.committing),
    action("pull", "Pull", "Pulling…", "Pulled", ctx.isBehind && !ctx.isDirty),
    action("pr", "Create PR", "Creating PR…", "PR created", !ctx.hasPr),
    action("view-pr", "View PR", "Opening…", "Opened", ctx.hasPr),
    action("push", "Push", "Pushing…", "Pushed", !ctx.isDirty && !ctx.pushing),
    action("merge-branch", "Merge branch", "Merging…", "Merged", ctx.hasBase),
    action("merge-from-base", "Update from base", "Updating…", "Updated", ctx.hasBase),
    action("merge-pr-squash", "Squash and merge", "Merging…", "Merged", Boolean(ctx.prMergeable)),
    action("enable-pr-auto-merge", "Enable auto-merge", "Enabling…", "Enabled", !ctx.prAutoMergeEnabled),
    action("pull-and-push", "Pull & Push", "Syncing…", "Synced", ctx.isBehind && !ctx.isDirty),
  ];

  // Primary precedence per spec
  let primary = allActions.find((a) => a.id === "archive-worktree" && a.disabled === false)
    ?? allActions.find((a) => a.id === "commit" && ctx.isDirty)
    ?? allActions.find((a) => a.id === "pull" && ctx.isBehind)
    ?? allActions.find((a) => a.id === "view-pr" && ctx.hasPr)
    ?? allActions.find((a) => a.id === "push")
    ?? allActions[0]!;
  const rest = allActions.filter((a) => a.id !== primary.id);
  return { primary, secondary: rest.slice(0, 2), menu: rest.slice(2) };
}

function action(id: GitActionId, label: string, pendingLabel: string, successLabel: string, available: boolean): GitAction {
  return { id, label, pendingLabel, successLabel, disabled: !available, status: "idle", icon: id, unavailableMessage: available ? undefined : `${label} is not available` };
}

// ─── PR activity timeline ──────────────────────────────────────────────────

export type PrActivityKind = "review_comment" | "review_state" | "check_run";

export type ReviewState = "approved" | "changes_requested" | "commented" | "dismissed";

export type CheckRunStatus = "success" | "failure" | "pending" | "cancelled";

export type PrActivity =
  | { kind: "review_comment"; id: string; author: string; body: string; filePath?: string; lineNumber?: number; url?: string; timestamp: number; canAttach: boolean }
  | { kind: "review_state"; id: string; author: string; state: ReviewState; body?: string; timestamp: number; canAttach: boolean }
  | { kind: "check_run"; id: string; name: string; status: CheckRunStatus; logsUrl?: string; timestamp: number; canAttach: boolean };

export type PrActivityFeed = {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  activities: PrActivity[];
  loading: boolean;
  error?: string;
};

export function sortActivitiesChronologically(activities: readonly PrActivity[]): PrActivity[] {
  return [...activities].sort((a, b) => a.timestamp - b.timestamp);
}

export function canAttachToComposer(activity: PrActivity): boolean {
  return activity.canAttach;
}

export type PrAttachment = {
  prNumber: number;
  prTitle: string;
  prUrl: string;
  location: string;
  body: string;
};

export function buildPrAttachment(feed: PrActivityFeed, activity: PrActivity): PrAttachment {
  const location = locationLabel(activity);
  const body = activityBody(activity);
  return { prNumber: feed.prNumber, prTitle: feed.prTitle, prUrl: feed.prUrl, location, body };
}

function locationLabel(activity: PrActivity): string {
  if (activity.kind === "review_comment") {
    if (activity.filePath) return `${activity.filePath}${activity.lineNumber != null ? `:${activity.lineNumber}` : ""}`;
    return "PR comment";
  }
  if (activity.kind === "review_state") return "PR review";
  return `Check run: ${activity.name}`;
}

function activityBody(activity: PrActivity): string {
  if (activity.kind === "review_comment") return activity.body;
  if (activity.kind === "review_state") return activity.body ?? activity.state;
  return `Check run ${activity.name} ${activity.status}${activity.logsUrl ? ` — ${activity.logsUrl}` : ""}`;
}

// ─── Inline review comments ───────────────────────────────────────────────

export type ReviewCommentDraft = {
  id: string;
  filePath: string;
  side: "old" | "new";
  lineNumber: number;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type ReviewCommentStore = {
  comments: ReviewCommentDraft[];
  diffMode: DiffMode;
};

export const INITIAL_REVIEW_STORE: ReviewCommentStore = { comments: [], diffMode: "uncommitted" };

export function addReviewComment(store: ReviewCommentStore, comment: Omit<ReviewCommentDraft, "id" | "createdAt" | "updatedAt">, now = Date.now()): ReviewCommentStore {
  const entry: ReviewCommentDraft = { ...comment, id: `review-${now}`, createdAt: now, updatedAt: now };
  return { ...store, comments: [...store.comments, entry] };
}

export function updateReviewComment(store: ReviewCommentStore, id: string, body: string, now = Date.now()): ReviewCommentStore {
  return { ...store, comments: store.comments.map((c) => c.id === id ? { ...c, body, updatedAt: now } : c) };
}

export function deleteReviewComment(store: ReviewCommentStore, id: string): ReviewCommentStore {
  return { ...store, comments: store.comments.filter((c) => c.id !== id) };
}

export function commentsForLine(store: ReviewCommentStore, filePath: string, side: "old" | "new", lineNumber: number): ReviewCommentDraft[] {
  return store.comments.filter((c) => c.filePath === filePath && c.side === side && c.lineNumber === lineNumber && c.body);
}
