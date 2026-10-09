# Task 005 — Web-client timeline: `CompactionRow`, reducer upsert, divider renderer

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (timeline/, features/chat/rows)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Every compaction (manual or automatic, live or replayed) renders as one full-width divider row that
updates in place from `Compacting context…` to its outcome, and a pure selector says whether a
session is currently compacting.

## Context / why

The timeline reducer ignores unknown kinds (`reducer.ts` `default:`). Live events and fetched
history both flow through the same `applyStreamEvent` (`lib/protocol/events.ts`
`flattenTimelineItems` → replay), so one reducer case covers live updates, reload, late join and
post-restart hydration. `SystemRow` only carries `text`, and a compaction needs phase, numbers and
an expandable summary, so this is a new row kind rather than a reuse.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Web-client (Timeline row, Compacting
  selector), § UI specification › Timeline divider row, § Behavior & algorithms (reducer
  pseudocode)
- `packages/web-client/src/timeline/row-model.ts:106-122` — row union, `SystemRow`
- `packages/web-client/src/timeline/reducer.ts:299-330` — `applyStreamEvent` switch, `replayEvents`
- `packages/web-client/src/features/chat/Timeline.tsx:57,138-139` — row dispatch
- `packages/web-client/src/features/chat/rows/SystemRow.tsx`, `rows.module.css`, `RowShell.tsx`
- `packages/web-client/src/timeline/markdown.tsx` — the assistant markdown renderer for the summary
- `packages/web-client/src/stores/session-store.ts:27,75-110` — `userMessageCount`
  (compaction rows must not count)
- `packages/web-client/src/features/workspace/status-bar-format.ts` — `formatTokens`
- Visual: spec § Timeline divider row

## What to build

- `row-model.ts`: `CompactionRow {kind:"compaction", id, compactionId, phase, reason?,
  tokensBefore?, estimatedTokensAfter?, summary?, error?, willRetry?, timestamp?}`, added to the
  `TimelineRow` union.
- `reducer.ts`: a `case "compaction":` that **upserts by `compactionId`**. It creates the row on
  first sight (any phase) and otherwise updates the existing row in place, merging only fields the
  event carries. On `turn_completed`/`turn_failed`/`turn_canceled`, flip any row still `started` to
  `canceled` (crash-safety net). Keep the existing turn handling intact.
- `timeline/compaction.ts` (pure): `isCompactionPending(rows)`, true iff some compaction row is
  `started`, plus a `compactionLabel(row)` formatter for the divider text:
  `Compacting context… (manual)`, `Context compacted · 168k → ~14k`,
  `Context compacted · 168k before`, `Compaction failed: <error>`, `Compaction canceled`. Reason
  labels: `manual`, `auto · threshold`, `auto · overflow`, plus ` · retrying turn` when
  `willRetry`. Omit the reason when absent.
- `features/chat/rows/CompactionRow.tsx` + styles: a centered-label horizontal divider, muted, with
  phase icon (spinner for `started`, reusing the `Spinner` primitive) and danger tone for `failed`.
  For `completed` rows with a summary, a disclosure toggle (button, `aria-expanded`, collapsed by
  default) reveals the summary rendered with the existing markdown renderer. No `RowShell` actions
  and no fork affordance.
- `Timeline.tsx`: dispatch `case "compaction"`.
- Docs: `packages/web-client/AGENTS.md` timeline section (new row kind, upsert rule, turn-end close
  rule).

## Out of scope

- Composer gating and the status-bar meter that consume `isCompactionPending` (tasks 006–008).
- Stats changes (task-006).

## Acceptance criteria

- [x] `started` then `completed` with the same id produces **one** row, ending `completed` with
      the completed fields.
- [x] A lone `completed` (hydrated) produces one row. Replaying the same events twice via
      `replayEvents` is idempotent per id.
- [x] A `started` row with no terminal event becomes `canceled` when the turn ends. Completed rows
      are untouched by turn end.
- [x] `isCompactionPending` is true exactly while a `started` row exists.
- [x] `compactionLabel` produces each documented string, including the absent-reason and
      absent-estimate variants.
- [x] Compaction rows do not change `userMessageCount`.
- [x] In a browser against `npm run dev:daemon`, a mock compaction (task-002/003, or a hand-sent
      `agent_compact_request`) renders the spinner divider, then the completed divider with a
      working summary toggle.

## Test / verification plan

- Tests: extend `timeline/reducer.test.ts`; new `timeline/compaction.test.ts`. Both are `.test.ts`
  node tests per the web-client convention (`.tsx` files are not picked up).
- Run: `npx vitest run packages/web-client/src/timeline` and `npm run build:web-client`.
- Manual: browser check above (record it in the summary). If tasks 002/003 are not done yet, inject
  the events through the reducer in a throwaway harness and say so.
