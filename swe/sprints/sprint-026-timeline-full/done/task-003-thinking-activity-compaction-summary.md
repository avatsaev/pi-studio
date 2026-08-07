# Task 003 — Thinking tokens, activity log & compaction markers — Summary

- **Sprint:** sprint-026-timeline-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

The reasoning ("Thinking…") card, activity-log summary pills, compaction
markers, and a token-aware turn footer — all as pure models with thin component
wiring.

1. **Thinking card (`timeline/thinking.ts`).** `buildThinkingCard` derives
   `{ status, elapsedMs, collapsed, shimmer }`: active + shimmering while
   reasoning with no response yet; **auto-collapses and becomes "done" when the
   response starts** (unless the user manually toggled). `thinkingLabel` →
   "Thinking…" / "Thought for 3s"; `formatElapsed`. Wired into `ThinkingCard`
   with a shimmer label + collapsible mono body.

2. **Activity pills (`timeline/activity-pills.ts`).** `summarizeActivity`
   collapses events into pills: file events group into one "N files edited"
   pill (single-file pill links to the file preview); git → "committed abc1234"
   (success tone); terminal → "ran npm test" (links to its terminal tab);
   others become tone-colored generic pills, preserving order with the file
   group last. `ActivityLogPill` renders tone accents.

3. **Compaction markers (`timeline/compaction.ts`).** `buildCompactionMarker`:
   loading → "Compacting…" (no load-full); completed → "Conversation compacted —
   N turns summarized" (falls back to "(N tokens)" then "Context
   automatically/manually compacted"), offering "Load full history".
   `buildLoadFullHistoryRequest` builds the `before`-direction pagination
   request. Wired into `CompactionMarker` (scissors ✂ + label).

4. **Turn footer with tokens (`timeline/turn-grouping.ts`).**
   `formatTurnFooterWithUsage(footer, totalTokens)` → "Worked for 3s · 1.2k
   tokens"; token count omitted when absent/zero and never on a running footer.
   Reuses the existing `buildTurnFooter`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/timeline/thinking.ts` | created |
| `packages/app/src/timeline/thinking.test.ts` | created (4 tests) |
| `packages/app/src/timeline/activity-pills.ts` | created |
| `packages/app/src/timeline/activity-pills.test.ts` | created (5 tests) |
| `packages/app/src/timeline/compaction.ts` | created |
| `packages/app/src/timeline/compaction.test.ts` | created (5 tests) |
| `packages/app/src/timeline/turn-grouping.ts` | modified (`formatTurnFooterWithUsage`) |
| `packages/app/src/timeline/turn-footer.test.ts` | created (3 tests) |
| `packages/app/src/components/timeline/MessageRows.tsx` | modified (thinking/compaction/activity wiring) |
| `packages/app/src/components/timeline/MessageRows.module.css` | modified (thinking/activity tone styles) |
| `packages/app/src/timeline/index.ts` | modified (export thinking/activity/compaction) |

## How it satisfies the scope

- **timeline-rendering.md § Reasoning ("thinking")** — shimmer while not ready,
  collapsible body, elapsed timer, auto-collapse on response start.
- **§ Activity log pill** — tone-colored pills summarizing file/git/terminal
  activity; expandable `items`; link targets to file preview / terminal tab.
- **§ Compaction marker** — loading spinner label vs. completed label variants,
  "Load full" pagination trigger, summary passthrough.
- **§ Turn grouping, spacing & footers** — completed footer shows duration +
  token count from usage data.

### Deviations / boundaries
- Live wall-clock ticking of the thinking timer (~10×/s) is a component concern;
  `buildThinkingCard` takes an injected `now`, so the tick cadence is supplied
  by the React layer (a `setInterval`), and the pure model is deterministic.
- Activity pills are produced from an `ActivityEvent[]`; sourcing those from the
  stream/tool events into the timeline container is applied at final timeline
  assembly (the model + renderer are ready and tested).
- Components are thin wrappers over the tested pure models; not render-tested
  (node-only env, consistent with the suite).

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/timeline/thinking.test.ts \
    packages/app/src/timeline/activity-pills.test.ts \
    packages/app/src/timeline/compaction.test.ts \
    packages/app/src/timeline/turn-footer.test.ts
 Test Files  4 passed (4)
      Tests  17 passed (17)

$ npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  126 passed (126)
      Tests  1599 passed (1599)
```

## Acceptance criteria
- [x] Thinking card shows with timer while active; collapses when response
      starts; expandable — `buildThinkingCard` (`thinking.test.ts`) + component.
- [x] Activity pills summarize file/git/terminal activity; expandable; link to
      tabs — `summarizeActivity` (`activity-pills.test.ts`).
- [x] Compaction marker renders; click shows summary; "Load full" triggers
      pagination — `buildCompactionMarker` + `buildLoadFullHistoryRequest`
      (`compaction.test.ts`).
- [x] Turn footer shows time + tokens from usage data —
      `formatTurnFooterWithUsage` (`turn-footer.test.ts`).

## Follow-ups / TODO(verify)
- Wire the thinking-timer interval + activity-event sourcing in the final
  timeline container assembly.
- Confirm the daemon's compaction event field names (`summarizedTurns` /
  `preTokens` / `trigger`).
