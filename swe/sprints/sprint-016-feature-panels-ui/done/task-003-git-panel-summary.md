# Task 003 — Git panel: changes, diff viewer, inline review, PR — Summary

- **Sprint:** sprint-016-feature-panels-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/panels/git-panel.ts` | Changes grouping, commit box, diff state, diff empty messages, git actions cluster, PR activity feed + sorting + attachment, inline review comment store |
| `packages/app/src/panels/git-panel.test.ts` | 16 tests |

## Tests

```
npx vitest run packages/app/src/panels/git-panel.test.ts
✓ 16 tests passed
```

## Acceptance criteria

- [x] Changes list groups staged/unstaged/untracked; canCommit gates on message + staged files.
- [x] Diff empty messages cover all documented cases (not-git, loading, uncommitted, committed, whitespace-hidden).
- [x] Git actions primary precedence: archive-worktree → commit → pull → view-pr → push; unavailable actions carry messages.
- [x] PR activity timeline sorts chronologically; canAttach gates attachment affordance; buildPrAttachment emits correct shape.
- [x] Inline review comments add/update/delete with line-filtered query.

## TODO(verify)

- Inline-review payload shape for submission is TODO(verify) per task notes.
- PR activity/check data shape from daemon is TODO(verify).
