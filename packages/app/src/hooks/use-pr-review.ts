/**
 * usePrReview — inline-review comment persistence (KV, scoped per workspace +
 * diff mode) + batch submission, and PR activity attach helpers.
 *
 * feature-panels-ui.md § inline review, § PR activity
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createWebKVStore } from "../providers/kv-store.js";
import {
  reviewStoreKey,
  serializeReviewStore,
  deserializeReviewStore,
  buildReviewBatch,
  type ReviewBatchPayload,
} from "../panels/pr-review.js";
import {
  addReviewComment,
  updateReviewComment,
  deleteReviewComment,
  commentsForLine,
  type ReviewCommentStore,
  type ReviewCommentDraft,
  type DiffMode,
  type PrActivityFeed,
} from "../panels/git-panel.js";

const kv = createWebKVStore();

export interface UsePrReviewResult {
  store: ReviewCommentStore;
  commentsForLine(filePath: string, side: "old" | "new", lineNumber: number): ReviewCommentDraft[];
  addComment(input: { filePath: string; side: "old" | "new"; lineNumber: number; body: string }): void;
  updateComment(id: string, body: string): void;
  deleteComment(id: string): void;
  clearAll(): void;
  buildBatch(feed: PrActivityFeed): ReviewBatchPayload;
}

export function usePrReview(
  serverId: string | undefined,
  cwd: string | undefined,
  diffMode: DiffMode,
): UsePrReviewResult {
  const key = serverId && cwd ? reviewStoreKey(serverId, cwd, diffMode) : null;

  const [store, setStore] = useState<ReviewCommentStore>(() =>
    deserializeReviewStore(key ? kv.get(key) : null, diffMode),
  );

  // Reload when the scope (workspace / diff mode) changes.
  useEffect(() => {
    setStore(deserializeReviewStore(key ? kv.get(key) : null, diffMode));
  }, [key, diffMode]);

  // Persist on every change.
  const persist = useCallback(
    (next: ReviewCommentStore) => {
      setStore(next);
      if (key) kv.set(key, serializeReviewStore(next));
    },
    [key],
  );

  const addComment = useCallback<UsePrReviewResult["addComment"]>(
    (input) => persist(addReviewComment(store, { ...input, body: input.body })),
    [store, persist],
  );

  const updateComment = useCallback(
    (id: string, body: string) => persist(updateReviewComment(store, id, body)),
    [store, persist],
  );

  const deleteComment = useCallback(
    (id: string) => persist(deleteReviewComment(store, id)),
    [store, persist],
  );

  const clearAll = useCallback(() => persist({ ...store, comments: [] }), [store, persist]);

  const commentsForLineFn = useCallback(
    (filePath: string, side: "old" | "new", lineNumber: number) =>
      commentsForLine(store, filePath, side, lineNumber),
    [store],
  );

  const buildBatch = useCallback((feed: PrActivityFeed) => buildReviewBatch(feed, store), [store]);

  return useMemo(
    () => ({
      store,
      commentsForLine: commentsForLineFn,
      addComment,
      updateComment,
      deleteComment,
      clearAll,
      buildBatch,
    }),
    [store, commentsForLineFn, addComment, updateComment, deleteComment, clearAll, buildBatch],
  );
}
