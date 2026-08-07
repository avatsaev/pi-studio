# Task 002 — Message rows, row treatments, turn grouping & footers — Summary

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/timeline/row-treatments.ts` | User/assistant/thinking/activity/compaction/error view models |
| `packages/app/src/timeline/turn-grouping.ts` | Turn segmentation, footer assembly, chrome suppression, duration formatting |
| `packages/app/src/timeline/file-links.ts` | Inline path-link detection, file:// URL parsing, tooltip model |
| `packages/app/src/timeline/row-treatments.test.ts` | 14 tests |

## Tests

```
npx vitest run packages/app/src/timeline/row-treatments.test.ts
✓ 14 tests passed
```

## Acceptance criteria

- [x] User/assistant/system/thinking/error row models have documented alignment/treatment.
- [x] Turn grouping segments at user_message boundaries with consecutive-block chrome suppression.
- [x] Footer assembly: running footer shows "Working…"; completed footer shows "Worked for <duration>".
- [x] File-link chips detected and workspace-relative labels resolved; file:// and external URLs parsed.
