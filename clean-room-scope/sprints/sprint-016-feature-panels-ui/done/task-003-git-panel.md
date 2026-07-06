# Task 003 — Git panel: changes, diff viewer, inline review, PR

- **Sprint:** sprint-016-feature-panels-ui
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001; sprint-015/task-004 (diff rows)

## Goal
Implement the git panel: the changes list, the diff viewer with inline review, and the PR surface.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § Git: changes / diff / PR
- `clean-room-scope/features/git-checkout.md`

## What to build
- Changes view: staged/unstaged/untracked groups with per-file status badges + diff-stat, stage/unstage/
  discard actions, select-a-file → diff; branch indicator + the commit box (message input, structured-
  generation "suggest message", commit, push/pull/sync, stash); streaming refresh on workspace git
  changes.
- Diff viewer: reuse the diff row renderer; per-file unified/side-by-side, collapse large hunks,
  server-highlighted spans; navigate between changed files.
- Inline review: add line comments / review notes on diff lines (where documented), draft → submit review,
  pending-comment markers.
- PR surface: create-PR flow (title/body, structured-generation suggestions, base/head), open-in-GitHub;
  auto-archive-on-merge reflected in the UI; a scrollable **activity timeline** merging review comments
  (inline + top-level), review-state changes, and CI check runs in chronological order (each entry showing
  its file/line or PR-level location + author/timestamp); an "attach to chat" affordance on a comment/
  review-with-body/`changes_requested` review, and on a **failed** check's logs, that adds the activity as
  a workspace attachment for the agent to act on.

## Out of scope
- Explorer/preview (tasks 001–002). Terminal (task-004). Browser/subagents (task-005). The diff row
  renderer itself (sprint-015/task-004 — reused here).

## Acceptance criteria
- [ ] The changes list groups staged/unstaged/untracked with stage/unstage/discard and a commit box
      (suggest-message + commit + push/pull/stash).
- [ ] Selecting a file shows its highlighted diff with large-hunk collapse and file navigation.
- [ ] The PR flow creates a PR (with suggested title/body) and shows status/checks; merge auto-archives.
- [ ] The PR activity timeline merges comments/reviews/checks chronologically, and a failed check's logs
      or a review comment can be attached to the composer as agent context.

## Test / verification plan
- Tests: changes grouping + action wiring; commit/suggest/push round-trips; PR create payload (mock
  client + structured-gen stub).

## Notes
- Inline-review payload shape is TODO(verify).
- Full PR activity/check data shape and the exact daemon RPC for fetching a failed check's logs are
  TODO(verify) — see `clean-room-scope/features/feature-panels-ui.md` § TODO(verify).
