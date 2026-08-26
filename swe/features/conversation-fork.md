# Feature — Conversation Fork (Time-Travel from a User Message)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: `agent-providers.md` (provider contract, Pi adapter), `agent-sessions.md`
> (session rebind invariants), `timeline-streaming.md` (timeline store, hydration, paging),
> `timeline-rendering.md` § Row treatments (user-message actions row), `composer-ui.md`
> (composer prefill, running-turn state), `ui-components.md` (IconButton, Dialog, toast host),
> `websocket-protocol` architecture (append-only RPC conventions, passthrough push family)
> Replaces: the former `features/rewind.md` (deleted 2026-08-26 — its conversation mode is this
> feature, done provider-natively; see § Relationship to the rewind RPC)

## Purpose

Let a user jump an agent's conversation back to any prior user message — directly from the
web-client transcript — using Pi's native `fork` primitive: the live `pi` process rebinds to a new
branched session file truncated just before that message, and the original prompt text lands in the
composer for editing and re-sending. This is real context time-travel (the agent genuinely forgets
the later turns), not a display-only truncation.

The feature has two halves:

1. **Daemon: post-fork timeline resync.** Today a successful `agent_fork_request` rebinds the pi
   process and the persistence handle but leaves the daemon's in-memory timeline — and therefore
   every connected client's transcript — showing the abandoned branch. Nothing consumes the fork
   RPCs yet, so nobody has hit this; a fork UI makes it mandatory to fix.
2. **web-client: fork affordance + picker.** A hover action on user-message rows and a
   "Fork from…" picker, with a confirm dialog, composer prefill, and multi-client convergence.

## Ground truth (verified against the repo + bundled `pi` 0.84.2, 2026-08-25)

These facts drive the design; do not re-derive them from memory:

- **Pi RPC `fork {entryId}`** (rpc.md § fork; `agent-session-runtime.js` `fork()`): requires the
  entry to be a **user message** on the active branch (`position` defaults `"before"`); creates a
  **new branched session file** via `SessionManager.createBranchedSession(targetLeafId)` containing
  the history up to just before that message; tears down the current runtime and rebuilds on the new
  file; returns `{text: <original prompt text>, cancelled}`. An extension's `session_before_fork`
  handler may cancel (`cancelled: true`, nothing rebinds). An **unsaved** session (no assistant
  response yet) throws `"This session has not been saved yet. Wait for the first assistant response
  before cloning or forking it."` **The forked message itself is NOT kept**: `position: "before"`
  sets `targetLeafId = selectedEntry.parentId`, so the branch ends at the entry *before* it and the
  message survives only as the returned `text` (composer prefill). **The visual spec's § 08 is
  wrong on this point in three places** (`- After Fork`): the label "fork point — this message is
  kept", the AFTER frame that still draws that bubble in the transcript (as drawn it would appear
  twice — transcript *and* composer), and the RULES line "The forked-from message stays in the
  transcript". None may be shipped; everything from the forked message onward leaves the
  transcript. A correction callout is pinned at the top of § 08 in that part file; the § 12 copy
  deck is unaffected (the bad label never reached it).
- **Pi RPC `get_fork_messages`** → `{messages: [{entryId, text}]}` — user messages on the active
  branch, in chronological order (`agent-session.js` `getUserMessagesForForking()` walks
  `sessionManager.getEntries()` in order).
- **Daemon plumbing already shipped (sprint-037):** `agent_fork_request` /
  `agent_fork_messages_request` registered in **both** bootstraps
  (`slash-command-operations.ts`); `PiAgentSession.fork()` re-reads `get_state`
  (`refreshSessionFile()`) after a non-cancelled fork, and the handler then calls
  `AgentManager.persistSessionHandle` so the record's `persistence.nativeHandle` points at the NEW
  branched file. Protocol schemas exist (`agentForkRequestSchema` etc., `messages.ts:565-606`).
  Client SDK facade methods exist and are tested: `agent(id).fork(entryId)` / `.forkMessages()`.
- **The mock provider implements both as inert stubs** (`mock-provider.ts:369-375`): `fork` returns
  `{text: "mock forked text for <id>", cancelled: false}` without rebinding anything;
  `getForkMessages` returns one synthetic entry. The dev daemon therefore answers these RPCs.
- **Timeline rehydration is the resync mechanism, for free:**
  `AgentClient.hydrateTimeline(handle)` (pi: `hydrateTimelineFromSessionFile` →
  `SessionManager.open(file).getBranch()`) rebuilds a complete `TimelineRow[]` from the JSONL the
  handle points at — which, post-fork, is exactly the forked branch. `timeline-rpc.ts` already uses
  this path for restarted daemons. **No truncation math is needed anywhere.**
- **`agent-service.ts` has `getTimeline`/`seedTimeline` only**; `seedTimeline` is deliberately a
  no-op when an in-memory store exists — a fork happens on a live session, so resync needs a new
  unconditional-replace entry point.
- **Hydrated rows carry fresh epoch/seq numbering** (`session-hydration.ts`), so any cursor a
  client holds from before the fork is meaningless afterwards — clients must refetch from scratch,
  never tail-sync.
- **Timeline user rows and Pi entry ids live in disjoint id spaces.** Live `user_message` events
  carry `messageId` = the client-minted `clientMessageId` echo (`row-model.ts`); Pi's `entryId` is
  its own JSONL entry id. Nothing correlates them today.
- **The `rewind` feature flag is falsely advertised.** `bootstrap.ts` sends every
  `SERVER_FEATURES` key as `true` (`Object.values(SERVER_FEATURES).map((k) => [k, true])`), but
  `registerRewindHandler` (`rewind-rpc.ts`, sprint-015) is **never called** from either bootstrap —
  an `agent.rewind.request` gets `unknown_message_type`. Its `revertFilesSince` dep (file
  time-travel) was never implemented, and its conversation mode only truncates the daemon timeline
  without telling the pi process anything (the agent would still remember the "rewound" turns).

## Relationship to the rewind RPC (decision)

Pi's `fork` **is** conversation rewind done right — provider-native, live-process-correct, already
plumbed end to end. The former `features/rewind.md` scope proposed the same user-facing capability
on a daemon-side timeline truncation, which would have left the `pi` process still remembering the
"rewound" turns; it was deleted once this feature absorbed its conversation mode, and its file mode
is now recorded as an extension concern in § Non-goals. This feature also cleans up the half-built
rewind surface that scope left behind:

- **Remove `rewind` from `SERVER_FEATURES`** (and its `SERVER_FEATURE_COMPAT` entry +
  `client-capabilities.test.ts` expectation). Feature flags are daemon→client advertisements, not
  wire schema — removal means "unsupported", which has been the truth since day one. No client ever
  consumed it.
- **Delete `rewind-rpc.ts` + `rewind-rpc.test.ts`** (unwired dead code) and
  `AgentTimelineStore.truncateBeforeMessage` (its only caller). Display-only truncation is the
  wrong primitive; resync-from-native-history replaces it.
- **Keep** the `agent.rewind.*` schemas in `messages.ts` and the `supportsRewind*` provider-manifest
  flags — both surfaces are append-only. Nothing reads either; see § Non-goals for why no future
  work should revive them.

## Public contract

### Existing RPCs (unchanged)

`agent_fork_request {agentId, entryId}` → `{payload: {text, cancelled}}` and
`agent_fork_messages_request {agentId}` → `{payload: {messages: [{entryId, text}]}}` are used
as-is. No schema changes.

### New broadcast: `agent_timeline_reset` (passthrough push convention)

Follows the `terminals_update` convention exactly (root AGENTS.md § Protocol overview): broadcast
to **every** active session (including relay sessions), no subscribe RPC, validated by the
`sessionMessageBaseSchema` passthrough fallback, local TypeScript interface + type guard at each
point of use — **not** a `messages.ts` union member.

```ts
{ type: "agent_timeline_reset", agentId: string, reason: "fork" }
```

`reason` is an open string so `/new`, `/resume`, `/clone`, and `switch_session` can reuse the same
push when they grow UIs (out of scope now). Receipt semantics: "your cached timeline for `agentId`
is invalid in its entirety — drop rows and cursors, refetch from scratch."

### New server feature flag: `forkTimelineSync`

Added to `SERVER_FEATURES` (+ COMPAT entry). The web-client only offers fork UI when the daemon
advertises it — an old daemon has the fork RPCs but not the resync, and forking against it would
strand every other client on the abandoned branch. Precedent: `thinkingLevels`, `extensionUi`.

### New daemon-internal surface

- `agent-service.ts`: `resetTimeline(agentId, rows: TimelineRow[])` — unconditionally replace the
  in-memory store (unlike `seedTimeline`'s no-op-if-exists). Subsequent live turns append normally
  (`startTurn` continues from the hydrated max epoch).

### Client SDK

No additions — `fork`/`forkMessages` already exist. The web-client consumes the broadcast directly
off the socket like other passthrough pushes (`use-terminal-exit-watch.ts` precedent).

## Behavior & algorithms

### Daemon: post-fork resync (`slash-command-operations.ts` `handleFork`)

```
payload = session.fork(entryId)                      # existing
if payload.cancelled: return                          # existing — nothing rebinds, nothing to sync
handleBefore = record.persistence?.nativeHandle
manager.persistSessionHandle(agentId)                 # existing — handle now points at the branch
handleAfter = record.persistence?.nativeHandle

if handleAfter != null AND handleAfter != handleBefore:   # rebind actually happened
    rows = resolveClient(record.provider).hydrateTimeline?.(record.persistence) ?? []
    resetTimeline(agentId, rows)                      # rows MAY be empty (fork to first message)
    broadcast({ type: "agent_timeline_reset", agentId, reason: "fork" })
```

- **The guard is "handle changed", not "rows non-empty".** A fork to before the first user message
  legitimately hydrates to an (near-)empty branch and MUST still reset; conversely the mock
  provider's stub fork changes no handle, so the dev daemon's timeline is never wiped by a mock
  fork. Provider-agnostic, no `provider === "pi"` check anywhere.
- Hydration is a synchronous fs read of the (small) branched JSONL — same cost profile as the
  existing restart-rehydration path in `timeline-rpc.ts`.
- The RPC response is sent after the reset+broadcast, so the requester never observes a success
  response while the daemon-side timeline still shows the old branch.

### web-client: fork affordance (user-message rows)

- Hover-revealed `IconButton` (xs, lucide `GitFork`, reserved-box + opacity-on-row-hover — the
  sprint-062 row-action pattern) on **confirmed** user rows only (never `pending`/`failed`
  optimistic rows). Hidden entirely when: `server_info.features.forkTimelineSync` absent, or a turn
  is running (same `running` signal the composer consumes — Pi tears down the runtime on fork;
  never offer it mid-stream), or the session is a draft with no live process.
- Click →
  1. `forkMessages()` (fresh, never cached — the list is only valid against the current branch).
  2. **Correlate** clicked row → entry by ordinal: the clicked row's index among the transcript's
     confirmed user rows (hydrated + live alike) equals the index into `messages` (both enumerate
     the active branch's user messages chronologically). Ids are never used — the two id spaces are
     disjoint (§ Ground truth).
  3. Confirm `Dialog` that **displays the matched entry's `text`** (first ~3 lines, clamped) — the
     user sees exactly what they're forking from, so an ordinal mismatch is visible before it acts.
     Copy: "Fork the conversation from this message? Later messages leave the agent's context. The
     original prompt is placed in the composer for editing." Confirm / Cancel.
  4. Ordinal out of range, or the matched entry's `text` differs from the clicked row's text
     (whitespace-normalized) → fall back to opening the picker (below) instead of the confirm
     dialog. Never fork an unverified entry.
- Confirm → `fork(entryId)` with a single in-flight guard (second attempt while pending is a
  no-op; dialog shows a spinner, buttons disabled).

### web-client: "Fork from…" picker (session ⋮ menu)

- Menu item gated identically to the affordance. Opens a dialog listing `forkMessages()` results
  chronologically (each row: clamped text, ordinal `#N`); selecting a row swaps to the same confirm
  step as above. Empty list ⇒ disabled state with "Nothing to fork yet". This path needs zero
  correlation and is the affordance's fallback target.

### web-client: on fork completion

```
onForkResult(payload):
    if payload.cancelled: toast "An extension declined the fork"; close dialog; done
    close dialog
    if composer draft is empty: set composer text = payload.text   # never clobber a draft
    # timeline refresh rides the broadcast (below) — the requester does NOT special-case it

onAgentTimelineReset(agentId):                      # every client, incl. the requester
    drop cached rows + cursors for agentId
    refetch fetch_agent_timeline from scratch (cursor null) and page to completion
    clear any pending optimistic user rows for agentId
```

- Refresh is broadcast-driven for all clients uniformly — the requester gets no bespoke path, so a
  second browser window, a relay-connected phone, and the initiating tab converge through one code
  path. (The RPC response only closes the dialog and prefills the composer.)
- Composer prefill only when empty — never clobber a draft, and never warn about skipping it.
- Failure (rpc_error — e.g. the unsaved-session error, unknown entry) → toast the message, dialog
  returns to idle, retry allowed.

### Alignment with the visual spec (`swe/UI design/fork-rewind-ui-specs/`)

The visual spec is **split by concern** — open only the part you are building. The index
(`Fork Conversation Visual Spec.dc.html`) carries § 00 scope, § 14 the acceptance checklist and a
table of contents; every part is a standalone renderable file named
`Fork Conversation Visual Spec - <Part>.dc.html`. Section numbers (§ 00–§ 14) are stable and are
what this document cites; inline `§ NN` references *inside* the HTML are click-through links to
whichever part owns that section, and each part carries a nav strip back to the index.

| Visual spec sections | Part file (`Fork Conversation Visual Spec - ….dc.html`) | Primarily needed by |
|---|---|---|
| § 00 scope · § 14 acceptance checklist | _(index)_ `Fork Conversation Visual Spec.dc.html` | everyone, first read |
| § 01 tokens this feature touches | `- Tokens` | every UI task |
| § 02 affordance anatomy/placement · § 03 when it exists | `- Affordance` | the user-row fork button |
| § 05 confirm anatomy · § 06 confirm states · § 07 picker step | `- Dialog` | the confirm + picker dialog |
| § 08 after a successful fork · § 09 other windows · § 10 motion | `- After Fork` | truncation + convergence |
| § 04 compact/touch under 500px · § 11 keyboard and assistive tech | `- Compact and Keyboard` | responsive/a11y |
| § 12 copy deck (verbatim strings) · § 13 edge cases and failure matrix | `- Copy and Edge Cases` | copy + QA |

Its decisions are adopted verbatim **except** § 08's kept-message premise, corrected in § Ground
truth above. § 07's "one dialog, two steps" is why the confirm and picker steps share one part file:
they are one component, not two.

## Data & persistence

- No new persistence anywhere. The daemon's `persistence.nativeHandle` follow-up already exists
  (sprint-037); daemon restart after a fork already rehydrates the forked branch. This feature only
  fixes the **live** view.
- No client-local persistence; timeline caches are already ephemeral per-connection state.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Extension cancels via `session_before_fork` | `{cancelled: true}` — no rebind, no reset, no broadcast; client toasts and returns to idle |
| Fork on unsaved session (no assistant reply yet) | Pi throws; daemon relays rpc_error; client toasts, dialog reusable |
| Fork to before the first user message | Branch hydrates (near-)empty; timeline resets to it; broadcast fires (guard is handle-change, not row count) |
| Turn running | Affordance/menu item hidden-or-disabled client-side; a raced RPC that errors anyway → toast |
| Ordinal/text correlation mismatch | Never fork silently — fall back to the picker |
| Mock provider fork (dev daemon) | Stub returns text, no handle change ⇒ no reset, no broadcast — dev timeline untouched |
| Daemon without `forkTimelineSync` | No fork UI rendered at all (RPCs exist but resync doesn't; forking would strand other clients) |
| Client without the broadcast handler (old web-client) | Passthrough push ignored; its next full timeline fetch heals it — degraded, not broken |
| Composer has a draft when fork succeeds | Draft preserved; prefill skipped |
| Concurrent fork from two clients | Second `fork` runs against the already-rebound branch; its `entryId` may no longer exist → Pi errors "Invalid entry ID for forking" → toast. Each success broadcasts its own reset |
| `agent_fork_messages_request` on dead/archived session | Existing `requireSession` error path → toast |

## Non-goals

- **File time-travel** — reverting workspace edits alongside the conversation is out of scope, and
  is an **extension** concern rather than a daemon one: Pi ships `git-checkpoint.ts` as an example
  extension (stash on `turn_start`, restore on `session_before_fork`), already hooked to the exact
  lifecycle events a fork fires. If this is ever wanted, preinstall that extension via curated packs
  (`preinstalled-extensions.md`); do **not** build a daemon-side checkpoint store or revive
  `agent.rewind.*`. The unconsumed `supportsRewindConversation/Files/Both` manifest flags
  (`provider-manifest.ts:28-30`) and the `agent.rewind.*` schemas remain on the wire only because
  both surfaces are append-only — nothing reads them.
- **Clone/new/resume/switch UI** — same rebind family, deliberately excluded; the
  `agent_timeline_reset` reason string leaves the door open.
- **Wiring `agent.rewind.request`** — superseded (see § Relationship to the rewind RPC).
- **Pi entry-id propagation onto stream events** — would make correlation exact instead of
  ordinal; noted as a possible later additive field on `user_message` events, not needed for MVP.

## Acceptance criteria

- [ ] Forking from a mid-conversation user message: the transcript truncates to before that
      message in **every** connected client without a reload (verified with two browser windows).
- [ ] The composer receives the forked message's original text (only when it was empty), and
      re-sending it produces a turn in which the agent demonstrably does not remember the
      abandoned branch (live check against a real `pi` process).
- [ ] The hover affordance's confirm dialog always displays the exact text of the message that
      will be forked from; a correlation mismatch opens the picker instead of forking.
- [ ] "Fork from…" in the session menu lists the active branch's user messages and forks the
      selected one.
- [ ] An extension-cancelled fork changes nothing and toasts.
- [ ] Daemon restart after a fork resumes into the forked branch (existing sprint-037 behavior,
      re-verified — regression guard).
- [ ] Dev daemon + mock provider: fork RPC answers, timeline is not wiped, no broadcast emitted.
- [ ] No fork UI is rendered against a daemon lacking `forkTimelineSync`.
- [ ] `server_info.features` no longer advertises `rewind`; `rewind-rpc.ts` and
      `truncateBeforeMessage` are gone; `agent.rewind.*` schemas remain in `messages.ts`.
- [ ] Verified over the relay transport as well as direct WS (broadcast reaches relay sessions).

## TODO(verify) — to resolve during implementation

- [ ] Pi's exact behavior when `fork` arrives mid-stream (teardown aborts the run vs. error) — the
      client gates on `running` regardless; confirm live and document.
- [ ] Whether steered/queued user messages appear in `get_fork_messages` identically to how the
      timeline renders them as user rows (ordinal-correlation assumption; text-equality fallback
      covers a mismatch either way).
- [ ] Confirm `persistSessionHandle` exposes enough to read the pre/post handle in
      `handleFork` without an extra record fetch (pure implementation detail of the guard).
