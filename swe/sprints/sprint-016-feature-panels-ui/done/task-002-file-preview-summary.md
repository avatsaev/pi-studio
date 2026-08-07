# Task 002 — File preview panel — Summary

- **Sprint:** sprint-016-feature-panels-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/panels/file-preview.ts` | Read-target resolution, preview kind detection, preview state builder, tab label, scroll-to-line |
| `packages/app/src/panels/file-preview.test.ts` | 7 tests |

## Tests

```
npx vitest run packages/app/src/panels/file-preview.test.ts
✓ 7 tests passed
```

## Acceptance criteria

- [x] Preview kind: markdown / image / binary / code detected by extension.
- [x] Read target: workspace-relative, absolute-within-root, absolute-outside-root, home-relative all resolved.
- [x] Code state has language, line count, and line-highlight for deep links.
- [x] Error state on file read failure.
