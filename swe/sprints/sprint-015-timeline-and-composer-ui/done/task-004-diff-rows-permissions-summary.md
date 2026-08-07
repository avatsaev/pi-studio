# Task 004 — Diff rows, permission prompts — Summary

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/timeline/diff-rows.ts` | Unified diff parser → hunk/line model, diff-stat, collapse/expand, truncation |
| `packages/app/src/timeline/permissions.ts` | Permission prompt model, option set, state machine (pending/responding/resolved) |
| `packages/app/src/timeline/diff-permissions.test.ts` | 9 tests |

## Tests

```
npx vitest run packages/app/src/timeline/diff-permissions.test.ts
✓ 9 tests passed
```

## Acceptance criteria

- [x] Diff parser classifies add/remove/context/header lines, counts stat, truncates oversized diffs.
- [x] DiffRowViewModel collapses large hunks with canExpand=true.
- [x] Permission prompt covers pending/responding/resolved states with correct button disabled/spinner logic.
- [x] buildAnswerPayload emits the right shape for the RPC round-trip.
