# Agent Timeline Persistence — Design

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [persistence.md](persistence.md), [agent-lifecycle.md](agent-lifecycle.md),
> [../features/timeline-streaming.md](../features/timeline-streaming.md),
> [../../docs/agent-stream-events.md](../../docs/agent-stream-events.md),
> [../../docs/daemon-audit-handoff.md](../../docs/daemon-audit-handoff.md) (findings A5, A6; approved
> improvement 3; improvement 8 for damaged files)

**Status: proposed, awaiting owner approval.** Nothing here is implemented. Sprint-150 task-003 starts
only after the owner approves this document. Approval is recorded in [Approval](#approval).

## 1. Summary

The daemon keeps each agent's timeline only in memory, one row per streamed chunk, and rebuilds it
from Pi's session file after a restart with new sequence numbers. This design makes the timeline a
daemon-owned file per agent:

- `agents/<sanitized-cwd>/<agentId>.timeline.jsonl`, one JSON row per line, append-only.
- Streamed text and reasoning chunks are merged into one row per message **when written**. Live
  broadcasts stay per chunk and per sequence number; a stored row covers a sequence range.
- Sequence numbers and epochs continue across restarts and resets. They never repeat or go backwards.
- Pi's session file is read only to create a timeline file that does not exist yet.
- Memory per agent is bounded: a tail of recent rows plus a sparse index by sequence number. Paging
  costs O(page), not O(total rows).
- Sealed rows are written to the OS at once (survives a daemon crash); `fsync` happens at turn ends,
  on a 5 s timer while a turn runs, and at shutdown (survives power loss).

## 2. Problem and measurements

### 2.1 What is wrong today

| # | Finding | Evidence in code |
|---|---|---|
| A5 | The timeline lives only in `timelinesByAgentId` (`agent-service.ts`), a module-level map with no delete path. Archive and delete do not touch it. | `record.timeline` is always `[]` (`create` writes `timeline: []`; import writes events nothing reads). All 6 records in the owner's `~/.pi-studio` have `timeline: []`. |
| A5 | One row per streamed chunk (`text_delta`, `thinking_delta`); merged only when read, by `projectRows`. | `timeline-store.ts` `append()` pushes every event; `event-mapper.ts` maps each delta to its own event. |
| A5 | `page()` selects a window, projects **all** of it, then slices to the limit. | `timeline-store.ts` `page()`: `rows.slice(start)` → `projectRows(window)` → `slice(0, limit)`; `hasNewer` and `sourceSeqRanges` scan all rows too. |
| A6 | After a restart the store is rebuilt from Pi's session file by `hydrateTimelineFromSessionFile`, which numbers rows from 0 with one epoch per user message. A cursor from before the restart means nothing. | `session-hydration.ts`. |
| A6 | The rebuilt rows are not the rows the live stream produced. | See 2.4. |
| A6 | The first prompt after a restart creates an empty store, so history never loads. | Fixed separately by task-001 (`timelineFor` seeds before the first append). This design replaces that seed with "open the file". |

### 2.2 How these numbers were measured

Throwaway scripts (not committed), run against the built `packages/server/dist` on Node 24, on the
owner's machine (ext4 on LVM in a VM). Inputs: one real Pi RPC turn captured by hand, and the 406 real
Pi session files in `~/.pi/agent/sessions` (93 MB, 1,371 user-initiated turns). To reproduce: replay a
captured `pi --mode rpc` event log through `createPiEventMapper` into `AgentTimelineStore`; run
`hydrateTimelineFromSessionFile` over a directory of session files; time `store.page()` calls.

### 2.3 Chunk granularity: how many rows a turn makes

One real turn (`pi --mode rpc`, Sonnet 5.5 through the owner's gateway, a `read` tool call and a
~500-word answer; 1,093 output tokens):

| | Per-chunk rows (today) | Merged on write |
|---|---|---|
| Pi events received | 326 | — |
| Rows in the timeline (incl. the user message) | **304** (284 `assistant_message`, 14 `reasoning`, 3 `tool_call`, 3 markers/user) | **8** |
| JSON bytes | 36,141 (119 B per row on average) | 4,724 |
| Projected items a client sees | 4 | 4 |

The answer was 3,438 characters in 283 text deltas: **12.1 characters per delta** (max 33), at 77
deltas per second. One capture, one model: other providers may chunk differently [INFERENCE for them].

Extrapolated over the 1,371 real turns, with chunks estimated as characters ÷ 12.1:

| Per turn | p50 | p90 | p99 | max |
|---|---|---|---|---|
| Chunk rows (estimate) | 54 | 742 | 4,073 | 5,803 |
| Merged rows (estimate) | 7 | 68 | 395 | 619 |

Per session (406 files), from the real `hydrateTimelineFromSessionFile` (already one row per message):
p50 11 rows, p90 87, p99 1,368, max 7,781. Expanding the three largest to live-shaped chunk rows gives
53,154, 40,217 and 29,152 rows.

### 2.4 The rebuilt timeline is not the live timeline

By reading `session-hydration.ts`: rebuilt rows number from 0 and use one epoch per user message;
assistant and reasoning rows are whole blocks with `final: true`; a tool call is two rows (running,
then completed) where live it is three (`started`, `running`, terminal); live-only rows are missing
(`compaction` `started`/`failed`/`canceled`, mid-stream `error`, the optimistic steer/follow-up
`user_message` rows, exact timestamps). So a restart changes what a client sees as well as its cursors.

### 2.5 Memory

| Measure | Result |
|---|---|
| Heap per chunk row, 12-char text (100,667 rows) | 178 B per row (18.0 MB) |
| All 406 real sessions held as live-shaped chunk rows (430,322 rows) | **99.1 MB** (230 B per row, tool outputs and images included) |
| The same sessions as merged rows (38,260 rows) | 52.0 MB |
| Eviction | none: `timelinesByAgentId` only grows |

Merging halves the heap here because tool output text dominates; it does not bound it. Only a tail
bound does (section 9).

### 2.6 `fetch_agent_timeline_request` paging cost today

The request is `{ agentId, cursor?, direction: "before" | "after", limit? }`. There is **no `epoch`
and no `projection` parameter**; the response is always projected items (the brief for this document listed both;
the schema in `packages/protocol/src/messages.ts` has neither). Epochs never reach the wire.

| Rows in store | First page | Tail (`before`, no cursor) | `after` from the middle | `after` near the end |
|---|---|---|---|---|
| 1,007 | 0.35 ms | 0.11 ms | 0.08 ms | 0.05 ms |
| 10,067 | 0.49 ms | 0.30 ms | 0.23 ms | 0.14 ms |
| 50,333 | 0.86 ms | 1.19 ms | 0.99 ms | 0.60 ms |
| 100,667 | 1.84 ms | 2.23 ms | 1.60 ms | 1.20 ms |
| 302,000 | 5.93 ms | 7.67 ms | 4.66 ms | 3.81 ms |

Each call is O(rows after the cursor), on the event loop. The workbench pages to completion on every
restore, resync and fork (`fetchTimelineEvents`, 200 items per page), so a full drain is pages ×
remaining rows:

| Timeline | Pages | Full drain | Worst page |
|---|---|---|---|
| Largest real session, live-shaped (53,154 rows, 4,856 items) | 25 | 26 ms | 3.2 ms |
| Synthetic: 100,000 rows, 50,000 single-row items | 250 | 582 ms | 6.9 ms |

**Honest reading:** at today's real sizes the paging cost is small. The design's case is that nothing
bounds it, nothing bounds memory, and a restart changes the data. Paging O(page) is a consequence of
the file design, not its reason.

### 2.7 Restart and disk

| Measure | Result |
|---|---|
| Rebuild from Pi's file (synchronous, inside the fetch handler) | 366 ms for all 406 files; largest (14.7 MB) 52 ms; p99 9.6 ms |
| Merged timeline bytes vs Pi's session file | 37.4 MB vs 93.0 MB in total; ratio p50 0.4, p90 0.7, p99 0.9 |
| …of which image bytes (6 rows) | 4.7 MB; longest single row 3.64 MB |
| Per-chunk rows instead (estimate) | ≈ +42 MB of row envelopes, about 80 MB in total [INFERENCE] |
| Scanning a 6.76 MB / 3.57 MB / 1.05 MB timeline file (read, parse every line, build an index) | 10 ms / 5 ms / 2 ms |
| `appendFileSync` of one row: 200 B / 4 KB / 64 KB payload | 2.5 µs / 4.8 µs / 27 µs |
| `fsync` after a small write | 6.1 ms |
| Atomic rewrite (temp file, `fsync`, rename): 1 MB / 6.8 MB / 15 MB | 7.1 ms / 10.9 ms / 16.7 ms |
| Existing agent-record save (temp, `fsync`, rename), 3 KB | 6.05 ms (done twice per turn: `running`, `idle`) |

Rebuilding is not slow. Per-chunk writes are not expensive in CPU (77 rows per second × 2.5 µs). The
costs that matter are bytes, row count, `fsync` count, and the lost continuity.

## 3. Decisions and alternatives

### 3.1 Where the timeline is stored

| Option | Verdict | Why |
|---|---|---|
| **JSONL file per agent next to the record** | **Chosen** | Append is one `write`. A torn write loses only the last line. Matches the file-based persistence stance ([persistence.md](persistence.md)), needs no dependency, is greppable and recoverable by hand. Delete and archive are file operations beside the record. |
| SQLite | Rejected | The daemon runs on Node (npm) and in a Bun-compiled binary. There is no SQLite that is the same in both: `bun:sqlite` vs `node:sqlite` (experimental) vs a native addon that the single binary cannot load. A new dependency and a second corruption model for a log we only append to and read by range. |
| One file for all agents | Rejected | Writes of all agents queue on one writer. A damaged byte affects every conversation. Reset and delete rewrite the whole file. |
| Keep rebuilding from Pi's session file | Rejected as the source of truth | Sequence numbers cannot persist (2.4), rows differ from live ones, Pi owns that format, and `/fork`, `/new`, `/resume` rewrite which file is current. Kept only as the one-time seed (section 7). |
| Embed rows in the agent record (`timeline: [...]`, the schema's original intent) | Rejected | Every append rewrites the whole record (7 to 17 ms and the whole file's bytes per message at the 6.8 to 15 MB scale), and `loadAllAgents` would parse every timeline at boot. |

### 3.2 When chunks are merged

| Option | Verdict | Why |
|---|---|---|
| **On write, sealing at message boundaries** | **Chosen** | One row per message: 8 rows and 4.7 KB for the measured turn instead of 304 rows and 36 KB. Load, index, memory and paging all see the small row count. The merged shape already exists: history rebuilt from Pi's file is one `final: true` row per block, and every client renders it. |
| On read (today) | Rejected | Keeps the 10× row envelope on disk, every restart parses and holds every chunk, every page projects chunks. |
| Chunk rows during the turn, merge when it ends | Rejected | Needs an in-place rewrite of the turn's tail: truncate then append loses the whole turn on a crash in between, and an atomic variant (supersede markers) keeps every chunk row forever. More machinery than the loss it removes. |
| Merge on write **and** flush the open message every ~1 s as continuation lines | Not chosen now; see owner decision 2 | Cuts the crash loss from "the open message" to "about one second of it", at the cost of a second line type the loader must fold. |

Only **consecutive** `assistant_message` or `reasoning` events merge. Everything else is one row per
event. Tool-call lifecycle rows (`started`, `running`, terminal) stay separate rows: they are sparse,
and parallel tool calls interleave, which would break the "one row covers one contiguous sequence
range" rule below.

### 3.3 The file is the daemon's own record, not a cache of Pi's

The timeline file is the source of truth for sequence numbers, epochs, timestamps and live-only rows.
Pi's session file stays Pi's: it is read once to create a timeline for an agent that has none.

## 4. File format

Path: `$PI_STUDIO_HOME/agents/<sanitized-cwd>/<agentId>.timeline.jsonl`, in the directory of the agent
record. `loadAllAgents` reads only names ending in `.json`, so `.timeline.jsonl`, `*.tmp` and
`*.corrupt-*` are never parsed as records (a test pins this). The agent id is a UUID, so the lossy
`sanitizeCwd` cannot make two timelines collide.

Line 1 is a header; every later line is a row. Lines end in LF; a row is never split across lines.

```jsonl
{"version":1,"agentId":"3f2c…","createdAt":"2026-11-25T09:15:20.100Z","startSeq":0,"startEpoch":0,"nativeHandle":"/home/u/.pi/agent/sessions/--proj--/2026-11-25T09-15-20-000Z_019f….jsonl"}
{"epoch":1,"seq":0,"timestamp":"2026-11-25T09:15:20.105Z","event":{"kind":"user_message","messageId":"c1","text":"Read note.txt, then explain append-only logs."}}
{"epoch":1,"seq":1,"timestamp":"2026-11-25T09:15:20.610Z","event":{"kind":"turn_started"}}
{"epoch":1,"seq":2,"timestamp":"2026-11-25T09:15:22.617Z","event":{"kind":"tool_call","callId":"toolu_01","tool":{"kind":"read","path":"note.txt"},"status":"started"}}
{"epoch":1,"seq":3,"timestamp":"2026-11-25T09:15:22.618Z","event":{"kind":"tool_call","callId":"toolu_01","tool":{"kind":"read","path":"note.txt"},"status":"running"}}
{"epoch":1,"seq":4,"timestamp":"2026-11-25T09:15:22.640Z","event":{"kind":"tool_call","callId":"toolu_01","tool":{"kind":"read","path":"note.txt","output":"alpha beta gamma\n"},"status":"completed"}}
{"epoch":1,"seq":5,"seqEnd":18,"timestamp":"2026-11-25T09:15:23.020Z","event":{"kind":"reasoning","text":"The file is tiny; answer from general knowledge…","final":true}}
{"epoch":1,"seq":19,"seqEnd":302,"timestamp":"2026-11-25T09:15:23.410Z","event":{"kind":"assistant_message","text":"An append-only log writes every change at the end of a file…","final":true}}
{"epoch":1,"seq":303,"timestamp":"2026-11-25T09:15:27.100Z","event":{"kind":"turn_completed"}}
```

| Part | Rule |
|---|---|
| Header `version` | `1`. A file with a higher version is treated as damaged (section 13). Version 1 files are read tolerantly (`.passthrough()`, per the handoff's decision to keep it on disk schemas). |
| Header `agentId` | Must equal the file name's id; a mismatch is damage. |
| Header `startSeq`, `startEpoch` | The sequence number and epoch in force when the file was created or last rewritten. They give the next numbers when no row follows (a fork to before the first message). |
| Header `nativeHandle` | The record's `persistence.nativeHandle` when the file was created or rewritten (`null` for a provider without one). See the handle guard in section 7. |
| Row `epoch`, `seq`, `timestamp` | Daemon-owned, as today. `timestamp` is the first chunk's for a merged row. |
| Row `seqEnd` | Present only when the row covers more than one sequence number (a merged row). Absent means `seqEnd = seq`. |
| Row `event` | An `AgentStreamEvent`, verbatim. On load only the envelope is checked (`kind` is a string); an unknown `kind` passes through, because the protocol is append-only and clients ignore kinds they do not know. |
| Never written | Ephemeral events (`tool_call` with `partial`, `queue_update`). They have no `seq`. |
| Order | `seq` strictly increases, and each row's `seq` is the previous row's `seqEnd + 1` (the only gaps are the crash gap in section 6 and a failed write in section 13). |

**Merge rules** (in the store, so every mode uses them): an `assistant_message` or `reasoning` event
joins the open row when the open row has the same `kind`, the same `messageId` (or neither has one) and
is not yet `final`; its `text` is appended, `seqEnd` becomes this event's `seq`, and `final` becomes
true if the event is a block-close marker. Anything else seals the open row first: a different kind, a
different `messageId`, any non-chunk event, a turn terminal, an interrupt, a shutdown flush. A
`final` event seals the row at once, so the next chunk starts a new row (the same boundary the
workbench reducer uses, `onAssistantMessage`/`onReasoning`). A textless `final` marker with no open
row is stored as its own row, so sequence numbers stay contiguous.

Live broadcasts do **not** change: every chunk is still broadcast at once with its own `seq`.

## 5. What is written when, and what a crash loses

| Event | Stored |
|---|---|
| Agent created, or a deferred draft | nothing; the file appears with the first row |
| First row of an agent | header, then the row |
| `user_message`, `turn_started`, non-partial `tool_call`, `error`, `compaction`, `turn_completed`/`failed`/`canceled` | one row each, written by `appendFileSync` at the moment of the append, before the next event is handled |
| `assistant_message` / `reasoning` chunks | held in the **open row** in memory (text appended in place); written as one row when sealed |
| Seal | one row; the sealing event (if any) follows it |
| `queue_update`, partial `tool_call` | never |

Sealing events that happen without a provider event: the interrupt path (`turn_canceled` arrives
through the normal subscription), archive and delete mid-turn (they interrupt first, so the same
path), and a `flush()` at daemon shutdown that seals every open row and syncs every file.

| What fails | What is lost |
|---|---|
| Daemon process dies (kill -9, OOM, panic) | The text of the **open message** only: the assistant or reasoning chunks not yet sealed. Every sealed row was written to the OS before the next event ran. Pi exits when its stdin closes (seen live in sprint-149/task-005), so the turn is dead too; Pi writes a message to its own file when the message ends, so its file does not hold the open message either [INFERENCE: not checked against Pi's code]. |
| OS crash or power loss | Rows written after the last `fsync`: at most 5 s of a running turn, nothing from a turn that ended (its terminal row forces a sync). |
| Crash in the middle of a row write | The torn last line, dropped on load (section 13). This is the expected result of a crash, not damage. |
| Graceful shutdown, archive, delete, interrupt | Nothing: open rows are sealed and the file synced. |

After a crash mid-turn the file ends inside a turn. On open the store appends the rows a live run
would have written, so the history is complete and no client replays a turn that never ends:

- A last turn with no terminal row (a `user_message` or `turn_started` after the last
  `turn_completed`/`turn_failed`/`turn_canceled`) gets `turn_failed` with
  `error: "interrupted: the daemon stopped during this turn"`.
- A `compaction` `started` with no terminal row for its `compactionId` gets `compaction` `failed`
  (the same rule `handleCompact` applies at runtime).

## 6. Sequence numbers and epochs across restarts

- `seq` is per **event**, as today: every persisted chunk takes the next number even though the file
  holds one row for many of them.
- On open: next `seq` = the last row's `seqEnd + 1` (or the header's `startSeq` when there are no
  rows); epoch = the last row's `epoch` (or `startEpoch`). The next `runTurn` starts epoch + 1, as
  today.
- A hard crash loses the open message, so its sequence numbers (say 40–90) are reused: the next row
  after restart takes the number after the last **written** row. This is safe because a sequence
  number only has meaning inside one connection's lifetime plus the page it was fetched with, and a
  daemon restart closes every socket. The workbench resync already replaces the whole timeline and
  keeps only live frames newer than the page's `seqEnd`.
- **A reset (fork) does not restart at 0.** Rows rebuilt for the new branch are renumbered from the
  agent's next sequence number and epoch, and the rewritten header records them as
  `startSeq`/`startEpoch`. So within one agent a sequence number is never reused after a reset, and a
  cursor from before the reset sees "newer rows" rather than a number that now means something else.
  Clients still refetch from scratch on `agent_timeline_reset`, as the workbench does today
  (`use-timeline-reset-watch.ts`; its comment about "fresh numbering" is updated with the code).
- Cursors stay the opaque base-10 string of a sequence number (`encodeCursor`).
  - `after c`: rows whose `seqEnd > c`. A row that straddles `c` is returned whole. The workbench only
    ever passes a page's `endCursor` (a row's `seqEnd`), so it never straddles.
  - `before c`: rows whose `seq < c`.
  - A page's `seqStart`/`seqEnd` are the lowest `seq` and highest `seqEnd` of its rows, so
    `fetchedThrough` in `use-session-resync.ts` stays correct. A fetch that lands while a message is
    open returns the open row with the text so far and `seqEnd` = its last chunk; chunks broadcast
    afterwards have a higher `seq` and are applied on top. Append and broadcast happen in the same
    tick, so no chunk can be in neither.

## 7. Open and seed order

`timelineFor(deps, agentId)` (added by task-001) becomes the one entry point, **asynchronous**: every
caller (`runTurn`, compaction, the fetch handler, import) is already async. A `TimelineRegistry` owned
by `AgentService` replaces the module-level map. It de-duplicates concurrent opens of one agent with
an in-flight promise (like the manager's `spawns` map).

```
open(agentId):
    if a store is open: return it
    1. file exists?
         scan it (async, streamed): check the header, parse every line, build the index,
         keep the tail; drop a torn last line; close an open turn/compaction (section 5)
         header.nativeHandle and record.persistence.nativeHandle both known and different?
             -> the file belongs to another Pi session: treat as missing (step 2); the old file
                is replaced by the rewrite, not quarantined
         damaged? -> rename to <file>.corrupt-<UTC timestamp>, log an error with the agent id
                     and reason, continue as missing (step 2)
    2. file missing, record has a persistence handle, provider has hydrateTimeline:
         rows = hydrateTimeline(handle)                   # today's session-hydration, once
         write the file atomically (header + rows renumbered from 0) -> open it
    3. otherwise: an empty store; the file appears with the first row
```

Why the handle guard (a deliberate addition to "read Pi's file only when the timeline file is
missing"): `/new`, `/resume` and `/clone` move the agent onto a different Pi session file and
`persistSessionHandle` follows, but only `/fork` resets the timeline. A file that outlives the Pi
session it describes would show the previous conversation forever and, after a crash inside
`handleFork` (between `persistSessionHandle` and the reset), the abandoned branch. Comparing one
string closes both without touching those handlers. See owner decision 3. It never fires when either
handle is `null` (a draft's first handle, the mock provider).

Agents that exist before the first release with this change have no file, so they take step 2 on first
use; so do sessions made by `import_agent_session`. The hydration read stays synchronous (Pi's
`SessionManager.open`); it runs once per agent, and the largest real session took 52 ms.

Nothing is opened at boot: `loadAllAgents` is unchanged, `list_agents` never reads a timeline, and
startup stays O(agents).

## 8. Operations on the file

| Operation | Effect on the timeline file |
|---|---|
| **Fork** (`agent_timeline_reset`, `reason: "fork"`) | `registry.reset(agentId, rows)`: renumber the rebuilt rows from the next `seq`/`epoch`; write `<file>.<pid>.<rand>.tmp` in the same directory (new header with `startSeq`, `startEpoch`, the new `nativeHandle`); `fsync`; rename over the file; rebuild index and tail. Only then broadcast `agent_timeline_reset`, so a client that refetches reads the new file. A crash before the rename leaves the old file whole (and the handle guard then rebuilds it); a leftover `.tmp` is ignored. Runs inside the existing `session` busy claim (`runExclusive`), so no turn is appending. A read that started before the rename keeps the old file open and the old index and finishes consistently; new reads see the new pair. |
| **Compaction** | No reset. Compaction appends `compaction` rows (`started`, then one terminal) like any event; earlier rows stay, as in Pi's own file. It is not a size lever for the timeline. |
| **Import** (`import_agent_session`) | The record is created with no timeline. The handler calls `open`, which takes step 2 from the imported handle and writes the file before the agent is published. `ImportSessionResult.timeline` and its `result.timeline.map(...)` are deleted. |
| **Archive** | The file stays. Archive interrupts a running turn (rows seal), flushes and syncs the file, and evicts the in-memory store. A later fetch of an archived agent re-opens it lazily. |
| **Delete** | Order: evict the store and mark it closed (a late event of the dying turn appends in memory only and never recreates the file), delete the **timeline file**, then delete the record. A crash in between leaves a record with no timeline (re-seeded from Pi on next use), never a timeline with no record. Children cascade through the same `deleteAgent`. A failed `unlink` is logged and does not fail the delete. |
| **`/new`, `/resume`, `/clone`** | Unchanged in this design (they do not reset the live timeline today); the handle guard (section 7) makes the file consistent at the next open. Whether they should reset like fork is out of scope. |
| **Daemon stop** | `flush()`: seal open rows, sync every open file. Wired into the existing shutdown path now, and into the ordered shutdown of improvement 5 (M5) when it lands. |

## 9. Memory: the in-memory tail and the sequence index

Per open agent the store holds:

- **Tail**: the newest rows, array ordered by `seq`. Bound: at most **1,000 rows and 2 MiB** of
  serialized row bytes (known at write time), whichever is hit first. Rows leave from the old end; the
  newest row always stays, even if it alone exceeds the byte bound (a 3.6 MB image row exists in the
  real data). The open row is part of the tail and is never written until sealed.
- **Sparse index**: one `{ seq, byteOffset }` entry for every 128th row of the file, built during the
  scan and extended on append. 16 bytes per 128 rows: a million rows cost ≈ 125 KB. Offsets are
  **byte** offsets (UTF-8), not string indexes.
- Counters: next `seq`, `epoch`, file size written, and the last row (replaces the `allRows().at(-1)`
  that `runTurn` uses to pick the final status).

Invariant: every row not yet in the file (only the open row) is in the tail, and the tail is always a
suffix of the log. Rows leave the tail only after they are in the file, and every file read stops at
the written size.

Whole stores are evicted too: on archive, on delete, and when an agent has been untouched for 15
minutes (a sweep on an `unref`ed 60 s timer). A cold open costs a scan: 2 to 10 ms for 1 to 7 MB. The ceiling
is therefore (agents in use) × (2 MiB + index), and a single hot agent can no longer grow without
bound. (Evicting whole stores alone, without a tail bound, would leave one very long agent unbounded.)

The constants (1,000 rows, 2 MiB, stride 128, 15 min, 5 s) live in one place and are tunable. At
today's measured sizes (largest real timeline: 7,781 merged rows, 6.8 MB) the bound is first hit by
the tail of the distribution; it exists for the agent that runs for months.

## 10. Paging algorithm and cost

`page({ direction, cursor, limit })` becomes asynchronous and no longer touches rows outside its
window.

```
page(after, c, L):
    start: first row with seqEnd > c       (c absent: the first row)
    if that row is in the tail:   binary search the tail by seqEnd            # O(log T)
    else:                         last index entry with seq <= c, read forward from its offset,
                                  skip rows with seqEnd <= c                  # <= 128 extra rows
    window = rows from start, file rows first then tail rows, read in 256 KiB chunks,
             growing until projectRows(window) has L+1 items or the log ends
    items  = first L of projectRows(window)   # the +1 item decides whether the last group
                                              # (tool call, assistant run) is complete
    seqStart/seqEnd/sourceSeqRanges/collapsed come from the rows of those items
    hasNewer = log.lastSeqEnd > seqEnd                                        # O(1)

page(before, c, L):
    end: the first row with seq >= c (c absent: the end of the log)
    read backwards block by block through the index, prepending rows until
    projectRows(window) has L+1 items or the log starts; items = last L,
    dropping the oldest item when the window started mid-log (its group may be cut)
```

- `projectRows` is reused unchanged except that a merged row contributes `sourceSeqStart = seq` and
  `sourceSeqEnd = seqEnd ?? seq`.
- **Cost: O(page + index stride)** rows read and parsed per call (page = the rows behind 200 items,
  typically 200 to 600 merged rows), independent of the total. A memory hit is O(log T + page). The
  limiting factor is bytes: a page of tool outputs is as large as those outputs, as it is on the wire
  today.
- A full drain (restore, resync, fork refetch) reads the file once, front to back: O(file), not
  pages × remaining rows. At 100,000 rows the worst measured drain today is 582 ms; here it is a
  sequential read, estimated in the tens of milliseconds [INFERENCE until task-003 measures it].
- Reads use `fs/promises`; the event loop never waits on a window read. Appends are the only
  synchronous file calls (2.5 µs per row).
- An unknown `direction` is no longer silently treated as `before`: the handler accepts `"before"` or
  `"after"` and rejects anything else. The CLI's `agent logs` sends `direction: "backward"` today and
  is fixed to `"before"` in the same change.

## 11. Durability and write cost

| When | What |
|---|---|
| Every sealed row | `appendFileSync` (open, write, close): in the OS page cache before the next event is handled. Survives any daemon death. |
| Turn terminal row, compaction terminal row | request an `fsync` (`open "a"`, `sync`, close, in the threadpool; works on Windows too). |
| While rows are being written | at most one `fsync` per agent per **5 s**, coalesced: a request during an `fsync` in flight sets a "dirty again" flag. |
| Reset, import seed, archive, shutdown | temp file `fsync`ed before the rename; `fsync` before closing. |
| Never | one `fsync` per row. At 6.1 ms each, the measured 304-row turn would cost 1.9 s. |

Write cost per turn on the measured machine:

| Turn | Rows | Synchronous event-loop time | `fsync`s (off the loop) |
|---|---|---|---|
| Median real turn | 7 | ≈ 20 µs | 1 (6 ms) |
| p99 real turn | ≈ 395 | ≈ 1 ms (long rows up to 27 µs each) | 1 + duration ÷ 5 s |
| Today, for comparison | — | — | 2 record saves per turn (12 ms), unchanged |

The new work is about the cost of one more record save per turn, off the event loop. The chunk merge
itself is a string append per chunk and one serialization per message.

The record file is **not** the timeline's durability: it keeps its current atomic rewrite, and still
does not `fsync` its directory (same as `atomicWriteJson`); the timeline's rewrite follows the same
rule.

## 12. The dev daemon's in-memory mode

`TimelineRegistry` takes an optional file backend. `dev-bootstrap.ts` (in-memory agents under
`/tmp/pi-studio-dev`, `deleteAgent` backed by a `Map`) and unit tests pass none:

- Rows are held in memory only: no file, no index, no handle guard, no seed from Pi's file at open
  (the mock provider has no `hydrateTimeline` anyway).
- Merging on write still applies, because the merge lives in the store. The tail bound does not,
  because there is nothing to read older rows back from; memory mode keeps all rows.
- `reset`, `remove` and `flush` do their in-memory part and nothing else.
- Production (`bootstrap.ts`) always passes the file backend, rooted at `home`.

The dev daemon and mock provider are moving out of the published package (M6, improvement 9); the
optional backend is also what keeps the large existing test base on the plain store.

## 13. Failure handling

This matches improvement 8 in the handoff (a damaged file is set aside under a new name and reported,
never silently replaced; the naming is F2's `*.corrupt-<timestamp>`). Until M5 adds a shared helper,
task-003 adds one small `quarantine(path)` next to `atomicWriteJson`, written so M5 can adopt it as it
is.

| Condition | Behavior |
|---|---|
| Last line has no terminating LF, or is not valid JSON | **Torn tail**: truncate to the last LF, log at warn with the agent id and bytes dropped, continue. Not quarantined. |
| Any earlier line is not valid JSON, fails the envelope check, has `seq` that does not increase, has `seqEnd < seq`, or the header is missing, has another `agentId`, or has a `version` above 1 | **Damaged**: rename to `<id>.timeline.jsonl.corrupt-<UTC timestamp>`, log an error (agent id, line number, reason), then rebuild from Pi's session file as if the file were missing. The agent stays usable; the old file is kept for manual recovery and never deleted by the daemon. |
| Rename in quarantine fails | Log the error and serve the agent from Pi's file in memory only (no file written), so the damaged file is not overwritten. |
| Pi's file is missing or unreadable at step 2 | An empty store (`hydrateTimelineFromSessionFile` already returns `[]`); the next row creates the file. |
| `appendFileSync` throws (disk full, permission) | Log an error once per agent, keep serving that agent from memory, stop writing to its file so it stays a valid prefix. The turn is never failed by a timeline write. A sequence gap follows if writing later resumes at the next open. |
| Window read fails (file removed or truncated underneath) | Fetch returns the error as an `rpc_error`; the store re-opens (re-scan) on the next request. |
| Two daemons on one home | Not supported; the pid file already prevents it. |
| Leftover `*.tmp` | Ignored on open; removed by the next rewrite of that agent. |

## 14. What changes in the agent record

- `agentRecordSchema` drops the `timeline: z.array(z.unknown()).default([])` field and its comment
  ("one file per agent holds the record AND its timeline rows"). The record keeps no timeline data.
- `create_agent` and the mock provider stop writing `timeline: []`; `import_agent_session` stops
  writing `result.timeline` (section 8); `ImportSessionResult.timeline` goes with it.
- The record schema is `.passthrough()`, so existing records with `"timeline": []` still load; the key
  is carried until someone rewrites it away. No migration (the stealth-project rule); the owner's 6
  records are `[]`.
- The record stays the only place for status, title, labels, config and the persistence handle. The
  timeline file is found by `(record.cwd, record.id)`.

## 15. Disk usage and retention

- **Size**: from the real sessions, 0.4 × Pi's own session file at the median and 0.7 × at p90
  (37.4 MB against 93.0 MB in total, 4.7 MB of that images). A live-written file is a little larger
  than the rebuilt one (three tool rows per call instead of two, turn markers, `compaction` rows).
  Plan for roughly **+50% of the disk a conversation already uses**. Without merging it would be about
  twice Pi's size [INFERENCE from 2.7].
- **Images** (`user_message.images[].data`, base64) are stored inline, as Pi's file and today's memory
  rows do. A row can reach several MB; the reader reads to the LF, not a fixed buffer, and the tail
  byte bound keeps memory in check. Storing images beside the file is a wire change (clients render
  `images[].data`) and is not part of this design.
- **Growth**: one file per agent, appended forever while the agent exists. Compaction does not shrink
  it. Archive keeps it. Only delete removes it.
- **Retention**: none in this change. The numbers do not call for one (the largest real timeline is
  6.8 MB). If it is needed later, the first candidate is compressing the timelines of agents archived
  for a long time; it needs its own decision because it changes the "readable by hand" property.

## 16. Code surface (for task-003)

| File | Change |
|---|---|
| `agent/timeline-store.ts` | Keeps `TimelineRow`, `projectRows`, cursors. `AgentTimelineStore` gains the open row and merge, the tail bound, the index and async `page`; `replaceRows` becomes `reset`. |
| `agent/timeline-file.ts` (new) | Format, header, scan with torn-tail handling, `append`, atomic `rewrite`, window reads, quarantine. No knowledge of agents. |
| `agent/timeline-registry.ts` (new) | `open`, `remove`, `reset`, `flush`, sweep; owns the stores; replaces `timelinesByAgentId`, `getTimeline`, `seedTimeline`, `resetTimeline`, `ensureTimelineSeeded`. |
| `agent/agent-service.ts`, `slash-command-operations.ts`, `session-operations.ts`, `timeline-rpc.ts` | Use the registry; fetch handler becomes async; steer uses the open store; `handleFork` calls `reset` before broadcasting. |
| `agent/agent-manager.ts` | `archiveAgent` and `deleteAgent` call the registry (flush and evict; evict, delete file). |
| `persistence/entity-schemas.ts`, `entity-stores.ts` | Drop `timeline`; path helper `timelineFilePath(home, cwd, id)` beside `agentFilePath`. |
| `daemon/bootstrap.ts`, `dev-bootstrap.ts` | Build the registry (file backend in production, none in dev); call `flush()` on shutdown. |
| Docs, same change | `persistence.md`, `timeline-streaming.md` § Data & Persistence, `docs/agent-stream-events.md`, root `AGENTS.md` § Persistence layout, `packages/server/AGENTS.md`, the stale header of `timeline-store.ts`, the comments in `use-timeline-reset-watch.ts` and `use-session-resync.ts`. |

The wire schema is unchanged (`fetch_agent_timeline_response` items keep their shape; assistant items
carry fewer, longer events, the same shape a rebuilt history already has), so no fixture or changelog
entry is expected; task-003 verifies that against `fetch_agent_timeline_response.json`.

## 17. Test plan

Unit (vitest, in `packages/server`):

- Merge rules: random chunk streams (kinds, `messageId`s, `final` markers, interleaved tool calls)
  folded through the merging store and a per-chunk reference store give the same flattened text per
  block and the same projected items; ranges are contiguous; a textless `final` is its own row.
- Format round trip; header validation; unknown event `kind` survives; `.timeline.jsonl`, `.tmp` and
  `.corrupt-*` are not read by `loadAllAgents`.
- Sequence and epoch continuation across close and re-open, with and without a trailing open row, and
  after a reset (renumbered above the old maximum, empty reset keeps `startSeq`).
- Torn tail: truncated at every byte position of the last line; the rest loads. Damaged middle line,
  bad `agentId`, higher `version`: quarantined once, file kept, rebuilt from Pi; a failing rename
  keeps the damaged file untouched.
- Crash recovery: a file ending mid-turn gets `turn_failed`; ending mid-compaction gets
  `compaction` `failed`; a file ending cleanly gets nothing.
- Open order: file wins over Pi; missing file seeds once and the second open does not call
  `hydrateTimeline`; mismatched handles rebuild; a `null` handle never does; no persistence handle
  gives an empty store and no file.
- Differential paging: the file-backed store and the in-memory store (no bound) return identical pages
  for random timelines over all directions, cursors (including row-straddling ones), limits and index
  strides, including pages that cross the file/tail boundary and the first and last rows.
- Tail bound: row and byte limits evict from the old end, keep the newest oversize row, and a cold read
  of an evicted range hits the file. Cost guard: the number of rows parsed for one page does not grow
  with the file (assert on a counter, not on wall time).
- Reset: file replaced atomically; a leftover `.tmp` is ignored; reads in flight finish against the old
  pair; `agent_timeline_reset` is broadcast after the rename. Delete removes the file before the record
  and a late append after delete creates no file. Archive keeps the file and evicts the store.
- Durability: a spy backend shows `fsync` after turn terminals, coalesced at 5 s, and never per row;
  an injected `ENOSPC` keeps the turn running and stops file writes after one error log.
- Resync race: an open row fetched mid-message plus live frames newer than its `seqEnd` replay to the
  final text exactly once (drives `use-session-resync` logic with a fake client).
- Memory mode: no files, all rows kept, merging still applies.
- CLI `agent logs` uses `direction: "before"`; the handler rejects other values.

Live, on a throwaway home and a free port (never the owner's daemon, `~/.pi-studio` or port 6767):
`kill -9` the daemon in the middle of a turn, restart, and check that the history, the sequence
numbers and a pre-crash cursor survive and the interrupted turn shows as failed (the sprint-149/task-005
recipe); then a fork and a restart.

## 18. Decisions needed from the owner

1. **Approve the shape.** A daemon-owned file per agent (`<agentId>.timeline.jsonl`, JSONL, merged on
   write), as the source of truth for the timeline, with Pi's session file used only to create it.
   *Recommendation: approve.* This is the gate for task-003.
2. **Accept that a hard crash loses the message being streamed.** Everything sealed survives; the
   open assistant or reasoning text does not (Pi's own file does not have it either, and the turn is
   dead). The alternative is flushing the open message about once a second as continuation lines: at
   most one second lost, at the cost of a second line type in the loader. *Recommendation: accept the
   loss; add continuation lines only if it is seen to matter.*
3. **Accept the handle guard.** The task text says Pi's file is read only when the timeline file does
   not exist. This design also reads it when the file's recorded Pi session differs from the agent's
   current one, so `/new`, `/resume`, `/clone` and a crash inside fork cannot leave a file that
   describes the wrong conversation. The alternative is to make those three handlers reset the
   timeline like fork. *Recommendation: accept the guard now; decide separately whether those three
   should reset live.*
4. **Accept the disk cost and no retention yet.** About +50% over what a conversation uses today, no
   deletion of old history, no compression. *Recommendation: accept; revisit with real totals after a
   month.*
5. **Accept storing images inline** in the timeline rows (rows up to several MB; 4.7 MB across the
   whole 406-session sample). *Recommendation: accept; moving images out of the rows is a wire change
   for a later milestone.*

## Approval

| | |
|---|---|
| Owner approved | **Pending.** Record the decision and the date here; task-003 starts only after this line is filled. |
