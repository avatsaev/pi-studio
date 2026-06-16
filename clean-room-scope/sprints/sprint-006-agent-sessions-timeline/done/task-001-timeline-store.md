# Task 001 — Append-only timeline store (epochs, sequences, paging)

- **Sprint:** sprint-006-agent-sessions-timeline
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-004 (sprint-005), task-004 (sprint-003)

## Goal
Implement the per-agent append-only timeline store: epochs, monotonic sequence numbers, projected
items, and bounded paged reads.

## Scope references
- `clean-room-scope/features/timeline-streaming.md` § Timeline model, § Behavior (server)
- `clean-room-scope/architecture/persistence.md` (rows persist alongside the agent record)

## What to build
- `agent-timeline-store.ts`: append projected row(s) with `(epoch, seq)`; each run starts a new
  epoch; append-only across epochs. Rows persist alongside the agent record.
- **Projected items:** a tool-call lifecycle is one projected item spanning many source sequences;
  assistant/reasoning chunks merge before counting toward a page limit.
- Read API returning a bounded page (default ~200 projected items) for `direction:"before"|"after"`
  from a cursor, with `seqStart`, `seqEnd`, `sourceSeqRanges`, `collapsed`, `hasNewer`,
  `startCursor`/`endCursor`.
- Daemon-owned canonical `timestamp` on each row (ignore provider replay timestamps for trust).

## Out of scope
- Live `agent_stream` broadcast + fetch RPC handler (task-003). Client sync planning (sprint-012).

## Acceptance criteria
- [ ] Appended rows get monotonic sequences; a new run increments the epoch.
- [ ] A tool-call spanning many source sequences is exactly one projected item.
- [ ] A page returns ≤ limit projected items with all paging fields populated.
- [ ] `hasNewer` is true while more rows exist after the page.
- [ ] Row timestamps are daemon-owned.

## Test / verification plan
- Tests: `npx vitest run .../timeline-store.test.ts` — sequencing, epoch increment, projection
  collapse, paging fields, page-limit counting.

## Notes
- Exact field names + cursor encoding + merge-count rules are TODO(verify).
