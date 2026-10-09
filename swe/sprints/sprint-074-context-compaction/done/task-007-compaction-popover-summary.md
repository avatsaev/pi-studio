# Task 007 — Web-client: Popover primitive, shared compact action, meter popover — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
`components/primitives/Popover.tsx` (Radix wrapper, exported from `primitives/index.ts`); `stores/compaction-store.ts` with the shared `compactSession` / `cancelCompaction` and a local pending flag + last error; `stats-store`'s `applyCompactionEstimate` (shared by the live event and the RPC fallback); `useIsCompacting` ORs the local flag with the timeline row; `ContextMeterPopover` (+ pure `compact-action.ts` priority table) makes the meter the trigger in `StatusBar`.

## Files created / changed
| File | Change |
|------|--------|
| `components/primitives/Popover.tsx`, `Popover.module.css`, `index.ts` | new primitive + export |
| `stores/compaction-store.ts` (+ test) | new |
| `stores/stats-store.ts`, `hooks/agent-stream-events.ts` | `applyCompactionEstimate` extracted/shared |
| `hooks/use-is-compacting.ts` | OR local pending |
| `features/workspace/ContextMeterPopover.tsx`, `.module.css`, `compact-action.ts` (+ test), `ContextMeter.tsx` (`wide`) | new / changed |
| `features/workspace/StatusBar.tsx`, `timeline/compaction.ts` (`pendingCompaction`) | wiring |
| `packages/web-client/AGENTS.md`, `swe/features/ui-components.md` | documented |

## Build & test results
```
$ npx vitest run packages/web-client -> 103 files, 1347 passed
$ tsc -b packages/web-client -> clean; oxfmt clean on changed files
```

## Acceptance criteria
- [x] `compactSession` refuses without sending (disconnected / no agent / running / pending or `started` row); otherwise exactly one request carrying the instructions
- [x] Pending cleared on success and failure; failure stores the daemon message verbatim
- [x] Estimate written from the response only without `compactionEvents`
- [x] Button states match the priority table; Cancel calls `interrupt` (unit-tested)
- [x] Browser, two windows on one agent (dev daemon + Vite): popover opens with the textarea focused; typing instructions and Compact now → button became Cancel, meter `Compacting…` and a `Compacting context… (manual)` divider appeared in BOTH windows, both settled to `Context compacted · 168k → ~14k (manual)`; instructions cleared; Escape closed the popover and focus returned to the meter trigger.

## Follow-ups / TODO(verify)
- The mock provider's compaction is not abortable, so the Cancel click was exercised (no error, `interrupt` sent) but did not produce a `canceled` row; real-Pi cancel is task-009's E2E.
- The mock reports no context window, so the meter shows `—` after compaction there; the `~N%` estimate path is covered by task-006's checks and unit tests.
