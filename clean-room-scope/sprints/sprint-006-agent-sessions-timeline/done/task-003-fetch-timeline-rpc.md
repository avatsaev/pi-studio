# Task 003 — Authoritative paged timeline fetch RPC

- **Sprint:** sprint-006-agent-sessions-timeline
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Implement the `fetch_agent_timeline_request` handler returning bounded pages of full projected items.

## Scope references
- `clean-room-scope/features/timeline-streaming.md` § Delivery paths, § Fetch request/response, § Behavior (server)
- `clean-room-scope/architecture/websocket-protocol.md` § Session message families

## What to build
- Handler for `fetch_agent_timeline_request`: return a bounded page of **full** projected items
  (never deltas) in the requested `direction` from the cursor, including `seqStart`, `seqEnd`,
  `sourceSeqRanges`, `collapsed`, `hasNewer`, `startCursor`/`endCursor`.
- Honor the default page size (~200 projected items) and relay-frame size bounds.

## Out of scope
- Client-side sync planning (sprint-012). Live stream (task-002).

## Acceptance criteria
- [ ] The response contains full projected items (no deltas) and all paging fields.
- [ ] `direction:"after"` from a cursor returns newer items; `"before"` returns older.
- [ ] Large histories are split into bounded pages with correct `hasNewer`.
- [ ] Live and fetched content converge (dedup by source sequence).

## Test / verification plan
- Tests: `npx vitest run .../fetch-timeline.test.ts` — direction paging, bounded pages, dedup vs.
  live rows.

## Notes
- Bounded ≠ partial: clients page to completion (`hasNewer:false`). Cursor encoding TODO(verify).
