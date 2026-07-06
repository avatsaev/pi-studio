import { describe, it, expect } from "vitest";
import {
  canAttachActivityToChat,
  canAttachCheckLogsToChat,
  isFailedCheck,
  prActivityToAttachment,
  checkLogsToAttachment,
  reviewStoreKey,
  serializeReviewStore,
  deserializeReviewStore,
  buildReviewBatch,
  reviewBatchToAttachment,
} from "./pr-review.js";
import { addReviewComment, type PrActivity, type PrActivityFeed, type ReviewCommentStore } from "./git-panel.js";

const feed: PrActivityFeed = {
  prNumber: 42,
  prTitle: "Add feature",
  prUrl: "https://github.com/o/r/pull/42",
  activities: [],
  loading: false,
};

const comment: PrActivity = {
  kind: "review_comment",
  id: "c1",
  author: "alice",
  body: "please fix",
  filePath: "a.ts",
  lineNumber: 10,
  timestamp: 100,
  canAttach: true,
};
const approvedNoBody: PrActivity = { kind: "review_state", id: "r1", author: "bob", state: "approved", timestamp: 200, canAttach: true };
const changesRequested: PrActivity = { kind: "review_state", id: "r2", author: "bob", state: "changes_requested", timestamp: 300, canAttach: true };
const failedCheck: PrActivity = { kind: "check_run", id: "ch1", name: "ci/test", status: "failure", logsUrl: "log-output", timestamp: 400, canAttach: true };
const okCheck: PrActivity = { kind: "check_run", id: "ch2", name: "ci/lint", status: "success", timestamp: 500, canAttach: true };

describe("attach gating", () => {
  it("always allows comments; gates review-state on body/changes-requested", () => {
    expect(canAttachActivityToChat(comment)).toBe(true);
    expect(canAttachActivityToChat(approvedNoBody)).toBe(false);
    expect(canAttachActivityToChat(changesRequested)).toBe(true);
    expect(canAttachActivityToChat(failedCheck)).toBe(false);
  });

  it("exposes logs only for failed checks", () => {
    expect(canAttachCheckLogsToChat(failedCheck)).toBe(true);
    expect(canAttachCheckLogsToChat(okCheck)).toBe(false);
    expect(isFailedCheck(failedCheck)).toBe(true);
    expect(isFailedCheck(okCheck)).toBe(false);
  });
});

describe("activity → attachment", () => {
  it("builds a review attachment carrying location + pr url", () => {
    const att = prActivityToAttachment(feed, comment);
    expect(att.kind).toBe("review");
    if (att.kind !== "review") throw new Error("expected review");
    expect(att.label).toContain("Add feature");
    expect(att.label).toContain("a.ts:10");
    expect(att.url).toBe(feed.prUrl);
  });

  it("builds a check-logs attachment", () => {
    const att = checkLogsToAttachment(feed, failedCheck);
    if (att.kind !== "review") throw new Error("expected review");
    expect(att.label).toBe("Check failed: ci/test");
    expect(att.url).toBe("log-output");
  });
});

describe("inline-review persistence", () => {
  it("scopes the KV key by workspace + diff mode", () => {
    expect(reviewStoreKey("s1", "/w", "uncommitted")).toBe("pi-studio-review-v1:s1:/w:uncommitted");
    expect(reviewStoreKey("s1", "/w", "committed")).not.toBe(reviewStoreKey("s1", "/w", "uncommitted"));
  });

  it("round-trips a store through serialize/deserialize", () => {
    let store: ReviewCommentStore = { comments: [], diffMode: "uncommitted" };
    store = addReviewComment(store, { filePath: "a.ts", side: "new", lineNumber: 3, body: "hi" }, 1000);
    const raw = serializeReviewStore(store);
    const back = deserializeReviewStore(raw, "uncommitted");
    expect(back.comments).toHaveLength(1);
    expect(back.comments[0]!.body).toBe("hi");
  });

  it("returns an empty store for null or corrupt data", () => {
    expect(deserializeReviewStore(null, "committed")).toEqual({ comments: [], diffMode: "committed" });
    expect(deserializeReviewStore("{not json", "committed").comments).toEqual([]);
  });
});

describe("batch submission", () => {
  it("collects non-empty drafts into a batch payload", () => {
    let store: ReviewCommentStore = { comments: [], diffMode: "uncommitted" };
    store = addReviewComment(store, { filePath: "a.ts", side: "new", lineNumber: 3, body: "one" }, 1);
    store = addReviewComment(store, { filePath: "b.ts", side: "old", lineNumber: 7, body: "two" }, 2);
    store = addReviewComment(store, { filePath: "c.ts", side: "new", lineNumber: 1, body: "  " }, 3);
    const batch = buildReviewBatch(feed, store);
    expect(batch.prNumber).toBe(42);
    expect(batch.comments).toEqual([
      { path: "a.ts", side: "new", line: 3, body: "one" },
      { path: "b.ts", side: "old", line: 7, body: "two" },
    ]);
  });

  it("summarizes a batch as one composer attachment", () => {
    const att = reviewBatchToAttachment({ prNumber: 42, prUrl: "u", comments: [{ path: "a", side: "new", line: 1, body: "x" }] });
    if (att.kind !== "review") throw new Error("expected review");
    expect(att.label).toBe("Review of #42 (1 comment)");
  });
});
