# Task 003 — One timeline row per message instead of one per chunk

- **Sprint:** sprints/sprint-150-lean-timeline
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (agent timeline store)
- **Priority:** P2
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The in-memory timeline holds one row per streamed message, not one per chunk, and what clients fetch
does not change.

## Context / why
Finding A5, the part that survives the design review (task-002, not adopted). One real turn makes 304
rows (284 of them text chunks) against 8 when merged; the merged shape is also what history rebuilt from
Pi's file already looks like. Memory halves and every page projects far fewer rows. Live broadcasts stay
per chunk and per sequence number, so nothing changes on the wire.

## Scope references
- `docs/daemon-audit-handoff.md` § A5; `swe/architecture/agent-timeline-persistence.md` § 2.3, § 3.2, § 6
  (the measurements and the merge rule; the file parts are not adopted)
- `packages/server/src/agent/timeline-store.ts` (`append`, `page`, `projectRows`, cursors)
- `packages/server/src/agent/agent-service.ts` (`appendStreamEvent`), `timeline-rpc.ts`

## What to build
- In the store, only **consecutive** `assistant_message` / `reasoning` events of one kind (and one
  epoch) merge into the last row: its text grows in place, and the row remembers the sequence range it
  covers (`seq` first, `seqEnd` last). Every other event is still one row.
- Sequence numbers stay per event: each chunk still takes the next number. Cursors stay the base-10
  string of a sequence number. `after c` returns rows whose `seqEnd > c`; `before c` rows whose
  `seq < c`. A page's `seqStart`/`seqEnd` are the lowest `seq` and highest `seqEnd` of its rows, so the
  workbench's `fetchedThrough` rule (`use-session-resync.ts`) still holds.
- A fetch that lands while a message is still streaming returns the row with the text so far.
- Fix the CLI `agent logs` `direction: "backward"` only if it is reachable (the server treats an
  unknown direction as `before` by accident): reject unknown directions in the handler and send
  `before` from the CLI.

## Acceptance criteria
- [ ] Equivalence test: random sequences of events (chunks, tool calls with interleaving, turn
      markers, compactions, errors) give the same projected items, `seqStart`/`seqEnd` and cursors
      from the new store as the pre-change behaviour for the same pages (compare against a reference
      implementation kept only in the test, or recorded expected outputs).
- [ ] 300 chunks of one message make one stored row; interleaved tool calls and a kind change
      (`reasoning` then `assistant_message`) start a new row.
- [ ] A cursor taken in the middle of a merged row pages without losing or repeating text.
- [ ] All existing timeline tests pass with unchanged meaning.

## Test / verification plan
- `npx vitest run packages/server/src/agent packages/workbench/src/lib/protocol`
- `npm run build:server`
