# Task 002 — Git panel (changes, diff viewer, inline review, PR)

- **Sprint:** sprint-022-feature-panel-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; sprint-016/task-003 (git panel model)

## Goal
Build the explorer sidebar's Changes + PR tabs: the changes list, diff viewer (unified + side-by-side on
wide), inline review comments, git-actions cluster, and the PR activity timeline with context-attach.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § git changes/diff/PR, § inline review
- `clean-room-scope/features/git-checkout.md`

## What to build
- Changes tab: diff-status bar (mode dropdown Uncommitted/Committed, layout toggle unified/side-by-side,
  whitespace toggle, files toolbar, refresh when advertised), virtualized file headers + bodies with
  sticky expanded headers; empty/loading/not-git messages. Consume sprint-016 git-panel model.
- Diff viewer: unified (gutter + tokenized code, wrap toggle) and side-by-side (two columns) on wide;
  binary/too-large placeholders; syntax highlighting via the highlight package.
- Inline review: hover/tap gutter `+` → threaded draft comments (add/edit/delete), persisted per
  workspace+mode; comments feed the composer as an attachment.
- Git actions cluster (primary + secondary + menu) with per-action pending/success + unavailable reasons.
- PR tab: activity timeline merging comments/reviews/checks chronologically; attach a comment/review/
  failed-check-logs to the composer.

## Out of scope
- Terminal (task-003). Browser/subagents (task-004). Explorer Files tab (task-001).

## Acceptance criteria
- [ ] Changes shows mode/layout/whitespace controls + virtualized sticky file headers + correct empties.
- [ ] Diff renders unified and side-by-side (wide) with highlighting; binary/too-large handled.
- [ ] Inline review comments anchor to lines, persist, and attach to the composer.
- [ ] Git actions show the right primary + reasons + pending/success; PR timeline merges chronologically
      and supports context-attach.

## Test / verification plan
- Tests: diff empty-reason + actions cluster (reuse model); inline review store; PR activity sort +
  attachment build (reuse sprint-016 git-panel model).

## Notes
- TODO(verify): inline-review submission payload + PR activity data shape (carried from sprint-016).
