# Task 003 — Authoritative paged timeline fetch RPC — Summary

- **Sprint:** sprint-006-agent-sessions-timeline
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/timeline-rpc.ts` — `registerTimelineHandler(registry)`: registers
`fetch_agent_timeline_request` which calls `getTimeline(agentId).page(...)` and returns a
`fetch_agent_timeline_response` with full projected items and all fields (`seqStart`, `seqEnd`,
`sourceSeqRanges`, `collapsed`, `hasNewer`, `startCursor`/`endCursor`). Missing timeline (restart)
→ empty page with `hasNewer:false`.

## Build & test results
```
$ npm run build:server      → exit 0
$ npx vitest run packages/server/src/agent/fetch-timeline.test.ts
 ✓ fetch-timeline.test.ts (4 tests)
```

## Acceptance criteria
- [x] Response contains full projected items and all paging fields.
- [x] `direction:"after"` from cursor returns newer items; items newer than `seqEnd` of prior page.
- [x] Large histories split into bounded pages with correct `hasNewer`.
- [x] Live and fetched content converge (dedup by source sequence — fetched seqs are a subset of live rows).
