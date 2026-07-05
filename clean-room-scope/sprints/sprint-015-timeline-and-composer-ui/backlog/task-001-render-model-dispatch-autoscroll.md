# Task 001 — Timeline reducers, sync planner, render model, virtualized list, row dispatch, autoscroll

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (sprint-013, host runtime/session context); sprint-012 (primitives)

## Goal
Implement the client-side timeline reducers/sync planner and the timeline render container: the
virtualized row list, row-kind dispatch, and the autoscroll / bottom-anchoring state machine.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § Timeline view consistency
- `clean-room-scope/features/timeline-streaming.md`
- `clean-room-scope/features/timeline-rendering.md` § The render model, § Row kinds, § Row dispatch,
  § Autoscroll / bottom anchoring

## What to build
- Timeline reducers: merge live `agent_stream` rows with authoritative `fetch_agent_timeline_request`
  pages, dedupe by sequence/cursor/source range, compact incremental deltas, detect gaps, and expose an
  ordered render-row list.
- Sync planner: on reconnect, catch up from the stored cursor to `hasNewer:false`; without a cursor,
  fetch the latest tail and let older history be scroll-driven.
- The render model: take the reducer's ordered, deduped rows and render a virtualized list keyed by stable
  row id; the list is the only consumer of the reducer output.
- Row dispatch: map each row kind to its renderer (user/assistant/tool-call/diff/permission/system/
  attachment/etc.); unknown kinds render a safe fallback.
- Autoscroll / bottom anchoring: track "pinned to bottom" vs "scrolled up"; new rows autoscroll only when
  pinned; a "jump to latest" affordance appears when unpinned; preserve position across catch-up page
  insertions (anchor on a stable row, not offset).

## Out of scope
- Row treatments + turn grouping/footers (task-002). Tool-call cards (task-003). Diffs/permissions
  (task-004). Markdown/highlighting (task-005). Composer (task-006).

## Acceptance criteria
- [ ] Live stream rows and paged timeline rows merge deterministically without duplicates.
- [ ] Reconnect catch-up fetches after the stored cursor to `hasNewer:false` and does not skip middle rows.
- [ ] Rows render via kind dispatch with a fallback for unknown kinds; the list consumes reducer output
      verbatim.
- [ ] New rows autoscroll only when pinned to bottom; scrolling up reveals "jump to latest".
- [ ] Inserting older catch-up pages does not jump the viewport (stable-row anchoring).

## Test / verification plan
- Tests: reducer merge/dedupe/gap detection; reconnect sync planner; dispatch table (kind→renderer +
  fallback); pinned/unpinned transitions; anchor preservation on prepend (pure helpers).

## Notes
- Use `@tanstack/react-virtual` for virtualization (see design-system § UI technology stack). Exact pin
  threshold is TODO(verify).
