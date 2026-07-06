# Task 003 — PR panel timeline & inline review persistence — Summary

- **Sprint:** sprint-027-git-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

PR activity attach-gating, inline-review comment persistence (KV, scoped per
workspace + diff mode), batch review submission, and failed-check-log
attachment — pure models (`panels/pr-review.ts`) + a persistence hook
(`hooks/use-pr-review.ts`) + PR-timeline component enhancements.

1. **Attach gating.** `canAttachActivityToChat` (comment always; review-state
   only with a body or `changes_requested`; check runs never as activity) and
   `canAttachCheckLogsToChat` (only `failure` check runs), matching the scope's
   `canAddPullRequestActivityToChat` / `canAddPullRequestCheckLogsToChat`.
   `isFailedCheck` helper.

2. **Activity → composer attachment.** `prActivityToAttachment` builds a
   `review` `DraftAttachmentMeta` carrying the PR title + activity location + URL
   (reuses the existing `buildPrAttachment`); `checkLogsToAttachment` builds one
   for a failed check's logs.

3. **Inline-review persistence.** `reviewStoreKey(serverId, cwd, diffMode)` (KV
   key scoped so Uncommitted/Committed keep separate comment sets),
   `serializeReviewStore` / `deserializeReviewStore` (null- and corruption-safe).
   `usePrReview` loads on scope change, persists on every add/update/delete/clear
   to the web KV store, and exposes `commentsForLine` + `buildBatch`.

4. **Batch submission.** `buildReviewBatch` collects all non-empty drafts into a
   `{ prNumber, prUrl, comments: [{path, side, line, body}] }` payload;
   `reviewBatchToAttachment` summarizes the whole batch as one composer pill.

5. **PR timeline UI.** `PrActivityPanel` now renders loading + error states, a
   descriptive per-activity label, failed-check rows with a left danger accent,
   an "Attach" button gated by `canAttachActivityToChat`, and a "Logs" toggle +
   "Attach logs" for failed checks (`onAttachLogs`).

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/panels/pr-review.ts` | created (pure model) |
| `packages/app/src/panels/pr-review.test.ts` | created (9 tests) |
| `packages/app/src/panels/index.ts` | modified (export pr-review) |
| `packages/app/src/hooks/use-pr-review.ts` | created |
| `packages/app/src/hooks/index.ts` | modified (export usePrReview) |
| `packages/app/src/components/panels/GitPanel.tsx` | modified (timeline rows, gating, logs, loading/error) |
| `packages/app/src/components/panels/GitPanel.module.css` | modified (failed/attach/logs styles) |

## How it satisfies the scope

- **feature-panels-ui.md § PR activity** — chronological timeline
  (`sortActivitiesChronologically`, pre-existing) with review comments,
  review-state changes, and check runs; loading skeleton + error state; attach
  affordances gated by `canAddPullRequestActivityToChat` /
  `canAddPullRequestCheckLogsToChat`.
- **§ Attach to chat** — comment/review/failed-check-logs become a `review`
  workspace attachment carrying PR number/title/url + location/body.
- **§ Inline code review** — drafts `{ id, filePath, side, lineNumber, body,
  createdAt, updatedAt }` keyed by a scope including the active diff mode,
  persisted across refreshes/tab switches; cleared on submit/delete.
- **task-003 acceptance** — timeline renders all activity types; attach adds a
  composer pill; comments persist across refreshes; batch submission builds the
  correct payload; failed-check logs viewable + attachable.

### Deviations / boundaries
- **`usePrActivityQuery`** already exists (sprint-023) and returns a `PrInfo`;
  this task adds the review/attach/persistence layer on top. Auto-refresh "on
  push events" is served by the existing `subscribeFileWriteInvalidation` +
  React Query invalidation; a PR-specific push-event subscription is a
  daemon-event follow-up (TODO(verify)).
- **Batch submission target** — `buildReviewBatch` produces the payload; whether
  it is sent to GitHub directly (daemon PR RPC) or attached to the composer for
  the agent is the caller's choice (`reviewBatchToAttachment` provided). Direct
  GitHub submission RPC is a daemon capability (git-checkout.md GitHub ops).
- **Check log body** — the component renders `logsUrl` as the log surface; the
  daemon projection for inline failure output is TODO(verify).
- Component is a thin wrapper over the tested pure model; not render-tested
  (node-only env). All gating/persistence/batch logic is unit-tested.

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/panels/pr-review.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)

$ npm run build
(clean)

$ npm test
 Test Files  130 passed (130)
      Tests  1645 passed (1645)
```

## Acceptance criteria
- [x] PR timeline shows real data from daemon/GitHub; auto-refreshes on events —
      `usePrActivityQuery` + `sortActivitiesChronologically` + invalidation;
      `PrActivityPanel` loading/error/rows.
- [x] Attach button adds context to composer; submitted with next message —
      `prActivityToAttachment` / `checkLogsToAttachment` (pr-review.test.ts).
- [x] Inline review comments persist across refreshes; batch submission works —
      `reviewStoreKey` + serialize/deserialize + `usePrReview`; `buildReviewBatch`.
- [x] Failed check logs viewable and attachable — `canAttachCheckLogsToChat` +
      logs toggle + "Attach logs".

## Follow-ups / TODO(verify)
- PR-specific push-event subscription for live auto-refresh.
- Daemon RPC for direct GitHub batch-review submission + inline check-failure
  log projection.
