# Task 001 — Sidebar session presentation model (pure) — Summary

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Completed:** 2026-08-18
- **Status:** done

## What was implemented

A new pure module, `features/sessions/session-presentation.ts`, exporting `sidebarSessionView(session)`
and `workspaceAttentionDot(sessions)`. `sidebarSessionView` maps a `SessionEntry` to the sidebar row's
presentation: state (`running`/`failed`/`empty`/`idle`, per the precedence in the task — error first,
then running, then "never used" (zero user messages and zero timeline rows), everything else including
`initializing`/`closed` folds into idle), a meta label, an optional failure reason (last `kind: "error"`
timeline row's text, first line only, trimmed, capped at 120 chars), a `StatusDot` input built through
`toDotStatus` (never a hand-rolled second vocabulary), and an italic-title flag (true only for `empty`).
`workspaceAttentionDot` reduces a workspace's sessions to a single attention dot: `statusDanger` when any
child failed, `null` otherwise (running is deliberately not attention, matching § 03's "child needs
attention" phrasing and the fact this client has no needs-input signal to source).

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/sessions/session-presentation.ts` | created |
| `packages/web-client/src/features/sessions/session-presentation.test.ts` | created |

## How it satisfies the scope

- § 03's STATE → TOKEN table: `running`/`failed`/`empty`/`idle` implemented exactly as specced;
  `needs input` is not implemented (unsourceable — no `agent.permission.*` plumbing and `status-map.ts`'s
  `MAP` never produces `waiting`), matching the sprint-061/task-004 precedent cited in the task.
- `session-store.ts`'s `SessionEntry` (`status`, `timeline`, `userMessageCount`) is the only type this
  module reads, via a type-only import — no runtime store or React import anywhere in the file.
- `timeline/reducer.ts`'s `onTurnFailed`/`onError` path (`{ kind: "error", text: event.error || "turn
  failed" }`) is exactly what `lastErrorReason` scans for, backwards, matching the "last row wins" rule.
- `status-map.ts`'s `toDotStatus` is the sole status-vocabulary translation point; this module never
  re-implements or re-exports it (per the task's explicit note).
- No deviations from the task's written contract.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/sessions/session-presentation.test.ts
 ✓ src/features/sessions/session-presentation.test.ts (20 tests) 3ms
 Test Files  1 passed (1)
      Tests  20 passed (20)

$ npx oxfmt packages/web-client/src/features/sessions/session-presentation.ts packages/web-client/src/features/sessions/session-presentation.test.ts
Finished in 85ms on 2 files using 32 threads.

$ npm run build:web-client
✓ built in 12.54s
(tsc -b runs as part of the vite build config; no type errors)
```

## Acceptance criteria

- [x] `sidebarSessionView` returns `running`/`failed`/`empty`/`idle` per the precedence in rule 1,
      including `initializing`/`closed` → `idle` (verified: "folds initializing into idle", "folds
      closed into idle" tests).
- [x] A failed session's `reason` is the last error row's text (not the first), single-line, trimmed,
      ≤ 120 chars; a failed session with no error row yields `reason: null` (verified: 5 dedicated
      reason-extraction tests).
- [x] `reason` is `null` for every non-failed state (verified: loop test over idle/running/initializing/closed).
- [x] `dot` is `null` for `idle` and `empty`; `{ status: "running" }` for running; a `statusDanger`-colored
      input for failed, asserted via `statusDotColor` (verified: 4 dot tests).
- [x] `titleItalic` is true only for `empty` (verified: 4-state assertion test).
- [x] `workspaceAttentionDot` returns a `statusDanger` input when any child failed, `null` for a mix of
      running/idle/empty children, and `null` for an empty array (verified: 3 tests).
- [x] No React or zustand import in `session-presentation.ts`, and no runtime store access — only a
      type-only `import type { SessionEntry }` (verified by inspection; build/typecheck confirms no
      unused-runtime-import errors and no React/zustand appears anywhere in the file).

## Follow-ups / TODO(verify)

- None. `needs input` and per-session cost/timestamps remain explicitly out of scope, as directed.
