# Task 005 — Browser pane & subagents track — Summary

- **Sprint:** sprint-016-feature-panels-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/panels/browser-pane.ts` | Nav state, Electron gating, URL validation (http/https/about:blank, auto-prefix), nav updates, descriptor, element capture type, new-tab validation, keyboard shortcuts |
| `packages/app/src/panels/subagents-track.ts` | Membership filter/sort, header label, chip builder, archive confirm, open/close confirm state, toggle, visibility |
| `packages/app/src/panels/browser-subagents.test.ts` | 12 tests |

## Tests

```
npx vitest run packages/app/src/panels/browser-subagents.test.ts
✓ 12 tests passed
```

## Acceptance criteria

- [x] Browser pane is `electron` variant on Electron; `unsupported` variant elsewhere with message.
- [x] URL validation: allows http/https/about:blank, auto-prefixes bare hosts, rejects unsafe schemes.
- [x] Nav state: navigation sets isLoading; loaded clears it; error sets lastError.
- [x] Subagents track excludes archived/pending-archive, sorts by createdAt, header labels running count.
- [x] Archive confirm warns when running; open/close confirm state tracks agentId.
