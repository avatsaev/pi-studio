# Task 003 — Tool-call cards — Summary

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/timeline/tool-cards.ts` | Card presentation, icon/name/summary mapping, expanded detail sections, status visuals, truncation |
| `packages/app/src/timeline/tool-cards.test.ts` | 13 tests |

## Tests

```
npx vitest run packages/app/src/timeline/tool-cards.test.ts
✓ 13 tests passed
```

## Acceptance criteria

- [x] Each documented tool type maps to correct displayName/summary/icon.
- [x] Status maps to shimmer (running), alert icon (failed), static (completed/canceled).
- [x] Cards know when isLoadingDetails=true (running + no detail); collapsed/expand model via `hasDetails`.
- [x] Oversized output is truncated with character count.
- [x] Errors produce an additional error section in expanded detail.
- [x] `isPlan=true` for plan detail type.
