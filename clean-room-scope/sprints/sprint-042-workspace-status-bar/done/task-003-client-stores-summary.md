# Task 003 — Client stores: git branch retention, session model, stats slice — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
- **`git-store.ts`**: now retains `available`/`branch`/`upstream`/`ahead`/`behind`/`detached`/
  `conflictCount` from the `CheckoutStatusProjection` alongside the existing flattened `changes[]`
  mapping. A shared `EMPTY_BRANCH_META` constant resets all seven fields whenever the projection is
  `null`/`undefined`/`available:false` (not a git repo, or no projection yet).
- **`session-store.ts`**: added `model?: string` to `SessionEntry`, plus `setModel(sessionId,
  model)` and `setModelByAgentId(agentId, model)` actions (the latter mirrors the existing
  `setStatusByAgentId` pattern). `hydrate` already accepted a full `SessionEntry`, so restoring a
  session with a `model` now flows through with no further change.
- **`stats-store.ts`** (new): a `Record<sessionId, SessionStats>` Zustand slice
  (`contextTokens`/`contextWindow`/`contextPercent`/`totalTokens`/`inputTokens`/`outputTokens`/
  `cost`/`model`) with `setStats(sessionId, partial)` (shallow-merge, preserves other fields for
  that session) and `clear(sessionId)` (removes one session only).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/stores/git-store.ts` | added branch metadata fields + reset-on-unavailable |
| `packages/web-client/src/stores/git-store.test.ts` | created — 5 tests |
| `packages/web-client/src/stores/session-store.ts` | added `SessionEntry.model`, `setModel`, `setModelByAgentId` |
| `packages/web-client/src/stores/session-store.test.ts` | created — 6 tests |
| `packages/web-client/src/stores/stats-store.ts` | created |
| `packages/web-client/src/stores/stats-store.test.ts` | created — 4 tests |

## How it satisfies the scope
- `clean-room-scope/features/git-checkout.md` § Checkout status projection: the projection's
  branch/ahead/behind/detached/upstream/conflict fields, already delivered over the wire and
  received by `use-checkout-status.ts`, are no longer discarded — the status bar's git segment
  (task-006) can now read them directly from `git-store` with no new subscription.
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata: `SessionEntry.model` and
  `stats-store` are the two pieces of session-scoped state the bar's remaining segments (model,
  context, tokens, cost) will read in task-006, populated by task-004's poll.

## Build & test results
```
$ npx vitest run packages/web-client/src/stores
✓ packages/web-client/src/stores/stats-store.test.ts (4 tests) 2ms
✓ packages/web-client/src/stores/git-store.test.ts (5 tests) 2ms
✓ packages/web-client/src/stores/explorer-store.test.ts (5 tests) 2ms
✓ packages/web-client/src/stores/session-store.test.ts (6 tests) 1ms
Test Files  4 passed (4)
     Tests  20 passed (20)

$ npm run typecheck
> tsc -b
(success, no output)
```

## Acceptance criteria
- [x] `git-store` exposes branch/ahead/behind/detached/upstream/conflictCount/available and resets
  them when the projection is unavailable; `changes[]` behaviour is unchanged — verified by
  `git-store.test.ts` (5 tests, including a dedicated "changes[] mapping unaffected" case).
- [x] `SessionEntry.model` exists; `setModel`/`setModelByAgentId`/`hydrate(model)` work — verified
  by `session-store.test.ts` (6 tests, including the no-op-on-unknown-id cases).
- [x] `stats-store` merges per-session partials and clears per session — verified by
  `stats-store.test.ts` (4 tests).
- [x] `npm run typecheck` passes; existing `explorer-store` test still green (ran alongside the new
  suites in the same command, 20/20 passing).

## Follow-ups / TODO(verify)
- None. `git-store`/`session-store` had no prior test files (only `explorer-store.test.ts` existed
  in this directory before this task); both were created fresh here rather than "extended" as the
  original task phrasing assumed — same outcome, no scope gap.
