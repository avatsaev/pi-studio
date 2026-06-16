# Timeline & Streaming Sync — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md)

## Purpose

Every agent has an **append-only timeline** of projected items (user messages, assistant messages,
reasoning, tool-call lifecycles, errors, turn markers). Delivery has two paths: a **live stream** for
immediacy and an **authoritative paged history** for correctness. The invariant: if the daemon has
committed timeline rows, any client that opens/resumes that agent eventually displays every row
through the daemon's current tail.

## Public Contract

### Delivery paths
| Path | Message | Guarantee |
|------|---------|-----------|
| Live stream | `agent_stream` | Immediacy; may be delta-shaped lifecycle updates |
| Authoritative history | `fetch_agent_timeline_request` → response | Full projected items, never deltas |

### Fetch request/response (shape)
- Request: agent id, a cursor and `direction: "before" | "after"`, page limit.
- Response carries: projected items, `seqStart`, `seqEnd`, `sourceSeqRanges`, `collapsed`,
  `hasNewer` (and an `endCursor`/`startCursor` to advance).

### Timeline model
- **Epochs:** each run starts a new epoch; timeline is append-only across epochs.
- **Sequence numbers:** source rows carry monotonic sequence numbers for client-side dedup.
- **Projected items:** a tool-call lifecycle is one projected item even if it spans many source
  sequence numbers; assistant/reasoning chunks are merged before counting toward the page limit.
- **Timestamps:** row `timestamp` values are canonical, daemon-owned. Providers may supply original
  replay timestamps, but clients must not apply local-clock trust heuristics or hide time UI.
- Default fetch page = ~200 projected items.

## Behavior & Algorithms

### Server
```
on agent event:
    append projected row(s) to the timeline store (epoch, seq)
    persist alongside the agent record
    broadcast agent_stream to subscribed clients (delta or full per event)

on fetch_agent_timeline_request:
    return a bounded page of FULL projected items in the requested direction
    include seqStart/seqEnd/sourceSeqRanges/collapsed/hasNewer + cursor
```

### Client sync planning
```
# resume WITH a known cursor
fetch direction="after" from cursor
while response.hasNewer: fetch next page from endCursor   # complete only at hasNewer=false
# do NOT replace with a latest-tail page (would skip middle of a long background run)

# first load / resume WITHOUT a cursor
fetch latest tail page (bounded)
older history is user-driven via upward scroll

# live
apply agent_stream rows immediately; reconcile against authoritative fetch by sequence
```

- **Catch-up is paged but complete.** Bounded pages avoid exceeding relay frame limits; bounded ≠
  partial. The cursor advances by sequence ranges so clients can skip delta rows without rendering
  them.
- **Presence is not delivery.** Client heartbeat (device type, app visibility, focused agent, last
  activity) is for notification routing only and must never gate live-stream delivery or hide rows.

## Data & Persistence
- Timeline rows persist alongside the agent record (`agents/{cwd}/{id}.json`). The store assigns
  epochs + sequence numbers. See [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Response too large for relay frame | Use bounded paging; client pages to completion |
| `hasNewer: true` | Client immediately fetches next page from `endCursor` |
| Duplicate live + fetched row | Deduped by source sequence number |
| Stale focus heartbeat | Affects notifications only; rows still delivered |
| Long background run + later open | Resume-with-cursor pages forward; no tail-only skip |
| Multi-source tool-call lifecycle | Collapsed into one projected item |

## Dependencies
- Internal: agent manager, timeline store, session forwarding, app sync planner + stream reducers.
- External: WebSocket transport.

## Acceptance Criteria
- [ ] After reconnect with a cursor, the client fetches `after` pages until `hasNewer:false`.
- [ ] A first load without a cursor fetches a bounded latest tail page.
- [ ] A tool-call spanning many source sequences appears as exactly one projected item.
- [ ] Live and authoritative paths converge on identical content (dedup by sequence).
- [ ] Row timestamps are daemon-owned regardless of provider replay timestamps.
- [ ] A stale heartbeat never removes rows from the live stream.

## TODO(verify)
- [ ] Exact `fetch_agent_timeline_request`/response field names and cursor encoding.
- [ ] Page-limit constant and how merge counting is applied.
