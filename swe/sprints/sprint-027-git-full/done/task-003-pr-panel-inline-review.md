# Task 003 — PR panel timeline & inline review persistence

- **Sprint:** sprint-024-git-full
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; sprint-023/task-002 (PR hooks)

## Goal
Wire the PR activity panel to real GitHub/daemon data and make inline review comments persist
across sessions and feed into the composer as context.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § PR activity, § inline review

## What to build
- **PR activity timeline**: fetch PR data via `usePrActivityQuery(serverId, cwd)`. Render
  chronologically: review comments (with code snippet context), review state changes (approved/
  changes requested), check run results (success/failure/pending with links to logs). Auto-refresh
  on push events.
- **Context-attach**: each PR activity item with `canAttach: true` has an "Attach" button → adds
  to composer as a `review` or `github_pr` attachment pill. When submitted, the agent receives
  the context.
- **Inline review persistence**: review comment drafts stored in workspace KV (keyed by
  workspace + diffMode + filePath + side + lineNumber). Survive across page refreshes and tab
  switches. Cleared when submitted or explicitly deleted.
- **Review submission**: "Submit review" button collects all draft comments → creates a batch
  payload → can be attached to composer for the agent to action, or submitted directly to
  GitHub via daemon PR RPC (if available).
- **Failed check logs**: check runs with `failure` status show expandable log output. "Attach
  logs" button attaches the failure output to the composer.

## Acceptance criteria
- [ ] PR timeline shows real data from daemon/GitHub; auto-refreshes on events.
- [ ] Attach button adds context to composer; submitted with next message.
- [ ] Inline review comments persist across refreshes; batch submission works.
- [ ] Failed check logs viewable and attachable.

## Test / verification plan
- PR data: mock query → verify timeline renders all activity types.
- Attach: click attach → verify composer pill added.
- Persistence: add comment → refresh → verify comment still there.
- Batch: add 3 comments → submit review → verify payload correct.
