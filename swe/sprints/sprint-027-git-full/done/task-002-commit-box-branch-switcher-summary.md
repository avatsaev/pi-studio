# Task 002 — Commit box, branch switcher & git actions — Summary

- **Sprint:** sprint-027-git-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

The commit box, branch switcher, git-actions-cluster state derivation, worktree
callout, and conflict resolution — pure models (`panels/git-controls.ts`) wired
to daemon RPCs via `useGitActions`, plus thin React components
(`components/panels/CommitBox.tsx`).

1. **Commit box.** `toggleStaged` (per-file staging), `buildCommitPayload`
   (trims message, carries staged files + `push` flag). `CommitBox` renders the
   file checkboxes, message textarea, a "Suggest" button (agent-generated via
   `checkout_suggest_commit_message_request`), and "Commit" / "Commit & Push"
   buttons gated on message + staged files.

2. **Branch switcher.** `filterBranches` (substring, prefix-ranked),
   `partitionBranches` (local/remote), `validateBranchName` (git-ref slugging:
   spaces→dashes, strips disallowed chars, rejects empty / `..`). `BranchSwitcher`
   is a combobox: search, grouped local/remote list, switch (→ checkout RPC),
   create (validated → `checkout_create_branch_request`), delete-with-confirm
   (→ `checkout_delete_branch_request`).

3. **Git actions cluster.** `deriveActionContext` projects a `GitStatusSummary`
   into the `GitActionContext` that the existing `buildGitActions` consumes;
   `primaryActionLabel` gives the headline (`Commit`/`Push`/`Pull`/`Up to date`)
   by repo state. New `useGitActions` mutations: `pull`, `fetch`, `createBranch`,
   `deleteBranch`, `suggestCommitMessage`, `resolveConflict`, `deleteWorktree`
   (plus the pre-existing commit/checkout/push/stash/stashPop), each invalidating
   the git query caches.

4. **Conflict resolution.** `hasConflicts`, `buildConflictList`,
   `buildResolveConflictPayload`, `allConflictsResolved`. `ConflictList` shows the
   conflicted files with "Ours" / "Theirs" / "Open" per file and an
   "All resolved" badge.

5. **Worktree callout.** `buildWorktreeCallout` → visibility + "Working on branch
   X in a worktree" message (consumed here and reused by task-004).

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/panels/git-controls.ts` | created (pure model) |
| `packages/app/src/panels/git-controls.test.ts` | created (15 tests) |
| `packages/app/src/panels/index.ts` | modified (export git-controls) |
| `packages/app/src/hooks/use-explorer-hooks.ts` | modified (pull/fetch/createBranch/deleteBranch/suggestCommitMessage/resolveConflict/deleteWorktree mutations; `CommitInput.push`) |
| `packages/app/src/components/panels/CommitBox.tsx` | created (CommitBox + BranchSwitcher + ConflictList) |
| `packages/app/src/components/panels/CommitBox.module.css` | created |
| `packages/app/src/components/panels/index.ts` | modified (exports) |

## How it satisfies the scope

- **feature-panels-ui.md § commit box** — message + suggest + commit + push,
  per-file stage/unstage.
- **§ git actions** — cluster `{primary, secondary, menu}` derived from repo
  state via `deriveActionContext` + `buildGitActions`; primary precedence
  preserved (commit when dirty, push when ahead+clean, pull when behind, …).
- **git-checkout.md § branch operations** — list/search/switch/create/delete,
  branch-name validation + slugging.
- **task-002 acceptance** — commit/suggest/push via RPCs; branch
  list/search/switch/create/delete via RPCs; actions cluster reflects
  dirty/ahead/behind/clean; conflict resolution UI shown when conflicts exist.

### Deviations / boundaries
- **RPC names** follow the existing hook convention
  (`checkout_*_request` / `git_*_request`) since the protocol envelopes are
  `.passthrough()` and don't strongly type git ops. TODO(verify) exact daemon
  names for pull/fetch/create-branch/delete-branch/suggest/resolve/worktree —
  the daemon side of these lands in sprint-008/010 territory.
- **Suggest message** returns `{ message }` from the daemon (structured
  generation per git-checkout.md); the component sets it into the textarea.
- Components are thin wrappers over the tested pure model + React Query
  mutations; not render-tested (node-only env). All branch/commit/action/conflict
  logic is unit-tested.

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/panels/git-controls.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)

$ npm run build
(clean)

$ npm test
 Test Files  129 passed (129)
      Tests  1636 passed (1636)
```

## Acceptance criteria
- [x] Commit box: write message, suggest from diff, commit, push — all via RPCs
      with feedback — `buildCommitPayload` + `useGitActions.commit/suggestCommitMessage`
      + `CommitBox` (git-controls.test.ts).
- [x] Branch switcher: list/search/switch/create/delete via RPCs —
      `filterBranches`/`validateBranchName` + mutations + `BranchSwitcher`.
- [x] Git actions cluster reflects repo state — `deriveActionContext` +
      `primaryActionLabel` + `buildGitActions` (push-when-ahead / commit-when-dirty tests).
- [x] Conflict resolution UI shows when conflicts exist — `hasConflicts` /
      `buildConflictList` / `ConflictList`.

## Follow-ups / TODO(verify)
- Confirm daemon RPC names + payloads for the new git ops.
- Worktree callout actions ("Back to main" / "Delete worktree") fully wired in
  task-004.
