# Task 005 — Rewind UI (Conversation & File Time-Travel) — Summary

- **Sprint:** sprint-021-timeline-composer-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `RewindMenu` | Inline dropdown on user messages (gated by `shouldShowRewindMenu(capabilities)`); lists `rewindMenuItems()` options (conversation/files/both); confirmation dialog for destructive modes (files/both); drives `startRewind()`→`rewindSuccess/Error()` + `postRewindActions()` |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/timeline/RewindMenu.tsx` | created |
| `packages/app/src/components/timeline/RewindMenu.module.css` | created |
| `packages/app/src/components/timeline/index.ts` | added RewindMenu export |
| `packages/app/src/components/timeline/timeline.test.ts` | added 8 tests (menu items, mutation states, post-rewind actions) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 98 files, 1290 tests passed
$ npm --workspace @av-pi-studio/app run build:web  # ✓ 387 kB, 753ms
```

## Acceptance criteria
- [x] The rewind menu appears only when capabilities allow, offering the supported modes.
- [x] Confirming a rewind issues the request, reflects pending state, and applies post-rewind actions.
- [x] Files/both rewinds confirm destructively; unsupported modes are disabled (menu empty when no caps).

## Follow-ups / TODO(verify)
- Exact `agent.rewind.*` RPC field names depend on server implementation.
- Post-rewind `refetch-tail` action needs timeline integration to truncate displayed rows.
