// PR activity attach-gating, inline-review persistence (KV), batch submission,
// and check-log attachment — pure models.
//
// clean-room-scope/features/feature-panels-ui.md § PR activity, § inline review

import type { DraftAttachmentMeta } from "../composer/draft-store.js";
import type {
  PrActivity,
  PrActivityFeed,
  ReviewCommentStore,
  ReviewCommentDraft,
  DiffMode,
} from "./git-panel.js";
import { buildPrAttachment } from "./git-panel.js";

// ─── Attach gating ───────────────────────────────────────────────────────────

/**
 * `canAddPullRequestActivityToChat`: a comment can always attach; a review-state
 * attaches when it carries a body or requested changes; a check run does NOT
 * attach as activity (use the logs gate for failed checks).
 */
export function canAttachActivityToChat(activity: PrActivity): boolean {
  switch (activity.kind) {
    case "review_comment":
      return true;
    case "review_state":
      return Boolean(activity.body) || activity.state === "changes_requested";
    case "check_run":
      return false;
  }
}

/** `canAddPullRequestCheckLogsToChat`: only failed check runs expose their logs. */
export function canAttachCheckLogsToChat(activity: PrActivity): boolean {
  return activity.kind === "check_run" && activity.status === "failure";
}

export function isFailedCheck(activity: PrActivity): boolean {
  return activity.kind === "check_run" && activity.status === "failure";
}

// ─── Activity → composer attachment ──────────────────────────────────────────

export function prActivityToAttachment(feed: PrActivityFeed, activity: PrActivity): DraftAttachmentMeta {
  const built = buildPrAttachment(feed, activity);
  return {
    kind: "review",
    label: `${feed.prTitle} — ${built.location}`,
    url: feed.prUrl,
  };
}

/** Attachment carrying a failed check's log output. */
export function checkLogsToAttachment(feed: PrActivityFeed, activity: PrActivity): DraftAttachmentMeta {
  if (activity.kind !== "check_run") {
    throw new Error("checkLogsToAttachment requires a check_run activity");
  }
  return {
    kind: "review",
    label: `Check failed: ${activity.name}`,
    url: activity.logsUrl,
  };
}

// ─── Inline-review persistence (KV) ──────────────────────────────────────────

const REVIEW_STORE_PREFIX = "pi-studio-review-v1";

/**
 * KV key scoped by workspace + diff mode so switching Uncommitted/Committed
 * remembers its own comment set.
 */
export function reviewStoreKey(serverId: string, cwd: string, diffMode: DiffMode): string {
  return `${REVIEW_STORE_PREFIX}:${serverId}:${cwd}:${diffMode}`;
}

export function serializeReviewStore(store: ReviewCommentStore): string {
  return JSON.stringify({ diffMode: store.diffMode, comments: store.comments });
}

export function deserializeReviewStore(raw: string | null, diffMode: DiffMode): ReviewCommentStore {
  if (!raw) return { comments: [], diffMode };
  try {
    const parsed = JSON.parse(raw) as { diffMode?: DiffMode; comments?: ReviewCommentDraft[] };
    return {
      diffMode: parsed.diffMode ?? diffMode,
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    };
  } catch {
    return { comments: [], diffMode };
  }
}

// ─── Batch review submission ─────────────────────────────────────────────────

export interface ReviewBatchComment {
  path: string;
  side: "old" | "new";
  line: number;
  body: string;
}

export interface ReviewBatchPayload {
  prNumber: number;
  prUrl: string;
  comments: ReviewBatchComment[];
}

/** Collect all draft comments into a batch payload for submission. */
export function buildReviewBatch(feed: PrActivityFeed, store: ReviewCommentStore): ReviewBatchPayload {
  return {
    prNumber: feed.prNumber,
    prUrl: feed.prUrl,
    comments: store.comments
      .filter((c) => c.body.trim().length > 0)
      .map((c) => ({ path: c.filePath, side: c.side, line: c.lineNumber, body: c.body.trim() })),
  };
}

/** A single composer attachment summarizing an entire pending review batch. */
export function reviewBatchToAttachment(batch: ReviewBatchPayload): DraftAttachmentMeta {
  const n = batch.comments.length;
  return {
    kind: "review",
    label: `Review of #${batch.prNumber} (${n} comment${n === 1 ? "" : "s"})`,
    url: batch.prUrl,
  };
}
