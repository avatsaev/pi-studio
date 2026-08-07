# Task 004 — Terminal pane — Summary

- **Sprint:** sprint-016-feature-panels-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/panels/terminal-pane.ts` | Terminal state, subscribe/resize/output gating, snapshot cache, LRU keepalive flag, descriptor label/bucket, mobile key bar with sticky-modifier chord logic |
| `packages/app/src/panels/terminal-pane.test.ts` | 10 tests |

## Tests

```
npx vitest run packages/app/src/panels/terminal-pane.test.ts
✓ 10 tests passed
```

## Acceptance criteria

- [x] shouldSendResize: claiming focused visible pane only.
- [x] Snapshot cache stores/retrieves/clears by serverId:cwd scope key.
- [x] LRU keepalive flag true when connected/connecting.
- [x] Mobile key bar 12 keys; Ctrl toggle produces correct chord; Alt prepends ESC.
