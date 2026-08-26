# Feature — Session Tree Navigation (Pi `/tree` in the web-client)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [conversation-fork.md](conversation-fork.md) (the `agent_timeline_reset` broadcast,
> `resetTimeline`, timeline-refetch client plumbing — this feature REUSES all three),
> `agent-providers.md` (provider contract), `timeline-streaming.md` (hydration mapper),
> `composer-ui.md` (prefill), `ui-components.md` (Dialog, toast), `workspace-split-panes.md` (pane
> tabs, tab identity), `websocket-protocol` architecture
> Note: this is the in-place ("same session file") half of conversation time-travel; fork is the
> new-file half. File time-travel is out of scope for both (see conversation-fork.md § Non-goals).

## Purpose

Bring Pi's `/tree` command to the web-client: view the session's **entry tree** (every branch ever
taken, not just the active path) and **jump to any point in it, in place** — same session file, no
fork. Selecting a prior user message rewinds the conversation there and puts its text in the
composer; selecting any other entry continues from that point; switching away from a branch can
optionally attach an **LLM-generated branch summary** so context from the abandoned path isn't
lost. This is Pi's richest time-travel primitive:

| | `/tree` (this feature) | `/fork` (conversation-fork.md) |
|---|---|---|
| Output | Same session file | New session file |
| Jump targets | ANY entry (user, assistant, tool, …) | User messages only |
| Abandoned-branch summary | Optional | Never |
| Typical use | Explore alternatives in place | Split off a separate session |

## Ground truth (verified against bundled `pi` 0.84.2 and published 0.84.3, 2026-08-25)

These facts drive the design; do not re-derive them from memory:

- **Read side EXISTS over Pi RPC.** `get_tree` → `{tree: [{entry, children, label?,
  labelTimestamp?}], leafId}` (single root normally; orphans appear as extra roots; children
  sorted by timestamp). `get_entries [{since}]` → `{entries, leafId}` — append-order entries with
  stable ids usable as durable cursors, **including abandoned branches and pre-compaction
  history** (unlike `get_messages`).
- **Write side DOES NOT exist over Pi RPC — the blocking upstream gap.** The core API is there:
  `AgentSession.navigateTree(targetId, {summarize?, customInstructions?, replaceInstructions?,
  label?})` → `{editorText?, cancelled, aborted?, summaryEntry?}` (`agent-session.js:2306`), but
  `rpc-mode.js` registers **no** `navigate_tree` command — checked in bundled 0.84.2 AND freshly
  published 0.84.3 (npm-packed, grepped: zero hits). The TUI calls `navigateTree` in-process; RPC
  clients cannot.
- **`navigateTree` semantics** (from source, `agent-session.js:2306-2466`):
  - Throws if a turn is streaming (`"Wait for the current response to finish…"`).
  - No-op `{cancelled: false}` if `targetId` is already the leaf.
  - `session_before_tree` extension event may cancel (same family as `session_before_fork`);
    extensions may also supply/override the summary, instructions, and label.
  - Target is a **user/custom message** → leaf moves to its *parent*, message text returned as
    `editorText` (edit-and-resubmit creates the new branch). Root user message → leaf resets to
    empty conversation, original prompt in `editorText`. **Any other entry** (assistant, tool,
    compaction, …) → leaf moves to that entry itself, no `editorText`.
  - `summarize: true` → LLM call (`generateBranchSummary`) over the entries between old leaf and
    the common ancestor; abortable; retried via the same machinery as compaction (the
    `summarization_retry_*` events with `source: "branchSummary"` already exist in the RPC event
    stream). Result appended as a persisted `branch_summary` entry at the new position, optional
    label attached. Nothing to summarize ⇒ silently skipped.
  - Afterwards Pi rebuilds the in-memory agent context from the new branch
    (`buildSessionContext()`); emits `session_tree` to extensions.
- **A summary-less leaf move is IN-MEMORY ONLY.** `SessionManager.branch(id)` / `resetLeaf()` just
  set `this.leafId` (`session-manager.js:1034-1047`) — **nothing is appended to the JSONL**. The
  position becomes durable only when the next entry is appended (its `parentId` pins the branch)
  or when a `branch_summary` entry is created. Two hard consequences:
  1. **Disk hydration cannot be the post-navigate resync source.**
     `hydrateTimelineFromSessionFile` (used by conversation-fork.md's resync and by restart
     rehydration) opens the file fresh and would compute the leaf from the file contents — blind
     to a summary-less move. Resync MUST read the **live process** (`get_entries` + `leafId`).
  2. **Position volatility across restarts is inherent to Pi**, not a Pi-Studio bug: navigate
     without summary, kill the process before the next message ⇒ resume lands back at the file's
     own leaf. The TUI behaves identically. Document, don't fight.
- **Tree filter modes** (default / no-tools / user-only / labeled-only / all) and label editing
  (Shift+L) are **TUI-local features** — filtering is pure view logic (client-side for us);
  arbitrary label editing has no RPC (the only wire path to set a label is `navigateTree`'s
  `label` option).
- **Daemon/protocol/SDK have NOTHING for this today** — no provider methods, no RPCs, no schemas.
  Everything below is additive. The nearest precedent for a long-LLM-call RPC is
  `agent_compact_request` (sprint-037); tree-navigate-with-summary has the same latency profile
  and must follow whatever timeout handling compact uses.
- **In Pi-Studio-only usage, session trees are LINEAR until this feature's write half ships** —
  branches appear in a file only when something moves the leaf backwards (TUI `/tree` on a shared
  session dir, or Phase 2 below). Read-only tree value before Phase 2 is limited to sessions also
  driven via the TUI (`PI_STUDIO_PI_HOME` shares Pi's session dir, so this is a real, if
  secondary, audience).

## Upstream prerequisite (Phase 2 gate)

Pi must gain a `navigate_tree` RPC command. Proposed upstream change (mirrors the existing `fork`
case; ~15 lines in `rpc-mode.ts` + the command/response types):

```jsonc
// stdin
{"type": "navigate_tree", "targetId": "abc123",
 "summarize": false, "customInstructions": "…", "replaceInstructions": false, "label": "…"}
// stdout
{"type": "response", "command": "navigate_tree", "success": true,
 "data": {"editorText": "…", "cancelled": false, "aborted": false, "summaryEntry": {…}}}
```

No `rebindSession()` needed (same file — unlike `fork`/`clone`/`switch_session`). Errors
(streaming, unknown entry) surface as `success: false` like every other command.

Delivery options, in order of preference:
1. **Upstream PR** to the Pi repo; bump the bundled `@earendil-works/pi-coding-agent` once
   released. Small, low-risk, benefits every RPC embedder.
2. **Vendored patch** (patch-package or pinned fork) if upstream stalls — same diff, carried
   locally; explicitly temporary.

A rejected third option, recorded so it isn't re-litigated: shipping a Pi-Studio *extension* that
wraps `navigateTree` behind a custom slash command driven through `prompt`. It technically works
(extensions run in-process with session access) but funnels a structured operation through the
prompt path, has no clean result channel, and breaks the daemon's "providers are adapters, not
extensions" layering.

**Phasing:** Phase 1 (tree read + visualization + fork-from-tree) has no upstream dependency and
ships first. Phase 2 (in-place navigation, summaries, resync) is gated on the prerequisite. Both
phases are specced here; the plan should make Phase 2's first task the upstream contribution.

## Public contract

### New RPCs (flat snake_case, real `messages.ts` schemas — the fork/compact family precedent)

| RPC | Phase | Inputs | Outputs |
|-----|-------|--------|---------|
| `agent_tree_request` | 1 | `agentId` | `agent_tree_response { payload: { nodes: TreeNode[], leafId: string \| null } }` |
| `agent_tree_navigate_request` | 2 | `agentId`, `targetId`, `summarize?: boolean`, `customInstructions?: string`, `replaceInstructions?: boolean`, `label?: string` | `agent_tree_navigate_response { payload: { editorText?: string, cancelled: boolean, aborted?: boolean, summaryCreated?: boolean } }` |

Both are live-session-only (`requireSession`; a draft/dead agent has no process to ask —
`unsupported`/`no_session` error convention from `slash-command-operations.ts`).

### Wire `TreeNode` (daemon-projected, NOT raw Pi entries)

```ts
interface TreeNode {
  id: string;
  parentId: string | null; // flat parent-pointer list — the daemon flattens Pi's nested get_tree
  kind: string;            // Pi entry type passed through: "message" | "compaction" | "branch_summary" | "model_change" | …
  role?: string;           // for kind "message": "user" | "assistant" | "toolResult" | …
  preview: string;         // first ~200 chars of the entry's text content, daemon-truncated
  timestamp: string;       // ISO-8601
  label?: string;          // /tree label, display-only
  labelTimestamp?: string;
}
// payload also carries leafId. Nodes ride in Pi's append order (children of one parent are
// already timestamp-sorted). The active path is derived client-side by walking parentId up from
// leafId; children/sibling lookups are one Map<parentId, TreeNode[]> away.
```

The daemon truncates content to `preview` — full message bodies never ride this RPC (trees can
span hundreds of entries; the transcript already has the full text of the active branch). All
schemas `.passthrough()` + optional fields, per protocol invariant #5.

Flat (parent-pointer) rather than Pi's nested `SessionTreeNode` shape, deliberately: a recursive
wire schema would be the protocol package's only `z.lazy()`, and every client consumer is a
parent-pointer operation anyway — the rendered tree is a flattened indented row list, the active
path is a leafId→root walk, and filter reparenting ("nearest visible ancestor", § Behavior) is a
pointer rewrite. The daemon flattens once at projection time.

### New stream event: `system_note` (additive `AgentStreamEvent` union member)

```ts
{ kind: "system_note", text?: string, source?: string }   // source: "branch_summary" today
```

Required because a branch-summary row has no wire vehicle today: the daemon's `TimelineRow`
(`timeline-store.ts`) is `{epoch, seq, timestamp, event: AgentStreamEvent}`, the
`AgentStreamEvent` union (`messages.ts`) has **no text-bearing system event**, and the
web-client's `system` row is minted client-side from `turn_canceled` only (`reducer.ts`).
Additive union member with optional fields — invariant #1 compliant; `source` is an open string
(the `agent_timeline_reset.reason` convention) so compaction markers etc. can reuse it later.
Phase 2 scope (summaries are created by navigation), though the mapper case below also un-drops
`branch_summary` entries a TUI-driven session already has on its active branch — cheap to ship
early if convenient.

### New server feature flags

- `sessionTree` (Phase 1) and `sessionTreeNavigate` (Phase 2) in `SERVER_FEATURES` (+ COMPAT
  entries). Two flags because the phases can ship releases apart: navigation is advertised only by
  a daemon whose bundled Pi carries the `navigate_tree` command (static per release — the Pi
  version is a pinned dependency). The web-client renders the tree read-only under `sessionTree`
  alone and enables jump actions only under `sessionTreeNavigate`.

### Provider contract (`provider-contract.ts`, all optional — absent by default)

```ts
getTree?(): Promise<{ nodes: ProviderTreeNode[]; leafId: string | null }>;
navigateTree?(targetId: string, opts?: { summarize?: boolean; customInstructions?: string;
  replaceInstructions?: boolean; label?: string }):
  Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryCreated?: boolean }>;
snapshotActiveBranch?(): Promise<TimelineRow[]>;   // live-process timeline rebuild (see below)
```

Pi implements all three; mock ships small static stubs (dev-daemon E2E, per the fork/extension-UI
convention).

### Reused surfaces (from conversation-fork.md — no duplicates)

- `agent_timeline_reset` broadcast, with `reason: "tree_navigate"` (the reason string was left
  open for exactly this).
- `agent-service.ts` `resetTimeline(agentId, rows)`.
- The web-client's reset listener (drop rows + cursors, refetch from scratch) — one code path
  serves fork and tree-navigate.
- Composer prefill rule: `editorText` fills the composer **only when it is empty**. Known
  tradeoff, accepted deliberately: for a user-message rewind, `editorText` is the *sole* carrier
  of the rewound text, so a non-empty composer drops it — never clobber a user's draft. The text
  stays recoverable in the tree (the just-abandoned node), and the confirm dialog showed it in
  full one click earlier.

## Behavior & algorithms

### Pi adapter: `snapshotActiveBranch` (the resync source — live, never disk)

```
entries, leafId = pi.get_entries()            # authoritative in-memory state incl. moved leaf
byId = index(entries)
chain = walk parentId from leafId up to root, then reverse   # the active branch, in order
return mapEntriesToTimelineRows(chain)        # factored out of session-hydration.ts
```

Requires refactoring `session-hydration.ts` into `file → entries` + `entries → TimelineRow[]`
halves so the mapper is shared between disk hydration (restart, fork) and live snapshot
(tree-navigate). `label` entries are skipped in the timeline (display lives in the tree view only).

**The `branch_summary` timeline row is genuinely new work at THREE layers, not a reuse — and the
load-bearing layer is the wire event, not the client row model.** `mapMessage`'s `default` branch
drops `branchSummary`/`compactionSummary`/`custom` entries outright
(`session-hydration.ts:116-118`); the daemon's `TimelineRow` (`timeline-store.ts`) carries an
`AgentStreamEvent`, whose union has no text-bearing system event to ride; and the web-client's
`system` row (`row-model.ts`) is minted only from `turn_canceled` (`reducer.ts`). So the work is:
(1) the additive `system_note` stream event (§ Public contract), (2) one mapper case
(`branchSummary` entry → `system_note` carrying the summary text) in the shared entries→rows
half, (3) one reducer case client-side (`system_note` → the existing `system` row — centered
muted marker, no rail entry; no new client row kind needed). Do not plan it as "reuse the
compaction row"; no such row or event exists anywhere in the shipped stack
(`timeline-rendering.md` § 04 lists one as a *design* row only).

### web-client: the tree is a new tab kind, not a dialog

Per the visual spec's § 02 decision (`- Pane`), the tree renders as a **pane tab** (splittable
beside the transcript), which is more plumbing than a dialog and must be planned for: add `"tree"` to
`TabKind` (`tab-store.ts:30`), a `tabIds.tree(sessionId)` minter, a `TreeTabData { sessionId }`
member, a `TabPanelHost` case, a `TabStrip` kind icon, and — because the tab is a *view of a
session*, not daemon-owned state — an identity round-trip in `tabIdentity`/`tabFromIdentity`
(`reopen-client-tabs.ts`) so a split survives reload the way `file:`/`diff:`/`molecule:` tabs do.
One tab per session; re-invoking the menu item focuses and refetches the existing tab.
Panes size by fraction (`MIN_PANE_FRACTION = 0.1`), so the spec's "pane minimum width 380px" is a
**layout rule the tree panel enforces itself** (below it the § 11 compact rules apply,
`- Compact and Keyboard`) — the pane system has no px floor to lean on.

### Daemon: `handleTreeNavigate` (`slash-command-operations.ts`)

```
session = requireSession(agentId); require session.navigateTree else unsupported
result = session.navigateTree(targetId, opts)
if result.cancelled: return result                       # nothing moved
rows = session.snapshotActiveBranch()                     # NEVER hydrate from disk here (§ Ground truth)
resetTimeline(agentId, rows)
broadcast { type: "agent_timeline_reset", agentId, reason: "tree_navigate" }
return result
# NOTE: no persistSessionHandle — the session file did not change.
```

`handleTree` is a thin read: `session.getTree()` → project to wire `TreeNode`s (truncate previews)
→ respond.

### web-client: tree view (Phase 1)

- Entry point: session "⋮" menu → "Session tree…" → opens the pane tab described above (visual
  spec § 02, `- Pane`; the rejected dialog/side-panel options are recorded there). Rows carry
  `preview` text, kind/role iconography, labels as chips, the **active path highlighted** and the
  **leaf marked**.
- Client-side filter control mirroring Pi's modes: default / no-tools / user-only / labeled-only /
  all (pure view filter over the fetched tree; no persistence in MVP). Pi's own filter predicates
  (`tree-selector.js:255-283`) are the reference: "default" hides `label`/`custom`/`model_change`/
  `thinking_level_change`/`session_info`; "no-tools" is default minus `toolResult` messages.
  Filtering must reparent survivors to the nearest visible ancestor rather than change tree shape.
- Branch fold/unfold (visual spec § 06, `- Filters and Folding`): abandoned branches deeper than
  one row start folded, the active path is always expanded and cannot be folded shut, fold state is
  per-pane and not persisted. Pi's TUI also has per-node folding, so this is parity, not invention.
- Refetch on open and on focus-after-blur (the tree is only valid against the current state); no
  live subscription, no polling.
- Phase-1 actions: none in-place. A user-message node exposes "Fork from here" **iff**
  conversation-fork.md has shipped and the node is on the **active branch** (Pi's `fork` only
  accepts active-branch user messages) — wired to the existing fork confirm flow, pre-targeted so
  its picker step is skipped.

### web-client: navigation (Phase 2)

Selecting a node (gated on `sessionTreeNavigate`, hidden while a turn is running):

1. **Confirm step** — mirrors the TUI's selection semantics, stated in the dialog:
   - user/custom message node: "Rewind to before this message; its text goes to the composer."
     Preview shown in full (same safety property as fork's confirm).
   - any other node: "Continue the conversation from this point." Preview shown.
2. **Summary choice** (same dialog, radio group — only rendered when the jump abandons entries,
   i.e. the current leaf is not an ancestor of the target; when in doubt, render it — Pi silently
   skips summarization when there's nothing to summarize):
   - No summary (default)
   - Summarize the abandoned branch
   - Summarize with instructions… (reveals a textarea → `customInstructions`)
3. Confirm → `agent_tree_navigate_request`; in-flight state (spinner, buttons disabled — a
   summarizing navigation is an LLM call and can take tens of seconds; same UX contract as
   compact). Single in-flight guard.
4. On success: dialog closes; composer prefill from `editorText` (only-if-empty rule); the
   transcript refresh rides the `agent_timeline_reset` broadcast — requester and every other
   client converge through the one shared listener.
5. `cancelled: true` → toast "An extension declined the navigation" (or "Summary aborted" when
   `aborted`); dialog returns to idle.

### Alignment with the visual spec (`swe/UI design/fork-rewind-ui-specs/`)

The visual spec is **split by concern** — open only the part you are building, not all 159 KB. The
index (`Session Tree Visual Spec.dc.html`) carries § 00 scope, § 13 the six closed questions, § 14
build order and a table of contents; every part is a standalone renderable file named
`Session Tree Visual Spec - <Part>.dc.html`. Section numbers (§ 00–§ 15) are stable and are what
this document cites; inline `§ NN` references *inside* the HTML are click-through links to whichever
part owns that section, and each part carries a nav strip back to the index.

| Visual spec sections | Part file (`Session Tree Visual Spec - ….dc.html`) | Primarily needed by |
|---|---|---|
| § 00 scope · § 13 questions closed · § 14 build order | _(index)_ `Session Tree Visual Spec.dc.html` | everyone, first read |
| § 01 tokens and the new visual vocabulary | `- Tokens` | every UI task |
| § 02 pane-tab decision · § 03 pane in situ · § 07 pane empty/loading/error | `- Pane` | Phase 1 pane task |
| § 04 node row anatomy (normative) · § 05 structural cases | `- Rows` | Phase 1 row/tree task |
| § 06 filters and folding | `- Filters and Folding` | Phase 1 filter task |
| § 08 Fork from here | `- Fork Action` | Phase 1 fork handoff |
| § 09 jump confirm dialog · § 10 Phase 2 states | `- Jump` | Phase 2 UI task |
| § 11 compact under 500px · § 12 keyboard and screen readers | `- Compact and Keyboard` | Phase 1 responsive/a11y |
| § 15 end to end (four frames, 1440×900) | `- End to End` | Phase 2 integration |

Its decisions are adopted verbatim; three points where it is *more* correct than an obvious reading
of this document:

- **No cancel affordance during summarization is a hard engine fact, not a UX preference.**
  `abortBranchSummary()` exists on `AgentSession` but is **not reachable over Pi RPC** — the only
  RPC that touches it is `dispose`. `abort` maps to `session.abort()` (turn abort), which never
  cancels a branch summary. So `{cancelled: true, aborted: true}` is only reachable via an
  extension's own abort signal, and the UI must not offer a cancel button.
- **`summarize: true` requires a selected model** — Pi throws `"No model available for
  summarization"` before touching the leaf. Surfaces as the summary-failed toast; nothing moved.
- **Every jump refetches the tree; the tree never patches itself optimistically** (visual spec § 15,
  `- End to End`). The tree pane and the transcript are two projections of one response.

One deliberate divergence to keep in mind: the RPC carries `label` (Pi's `navigateTree` option),
but **no UI sets it** — label chips are display-only per the visual spec's § 00 scope boundary
(index). The field stays on the wire because it is Pi's only label-write path and dropping it would
need a protocol addition later. Note that Pi writes a label as a real `label` **entry** appended at
the current leaf (`appendLabelChange`), i.e. labelling mutates the session file — another reason not
to wire it into the UI casually.

## Data & persistence

- No new Pi-Studio persistence. The tree lives in Pi's JSONL; the daemon holds nothing.
- **Documented volatility** (inherent to Pi, § Ground truth): after a summary-less navigation, the
  new position becomes durable only once the next message is sent (or a summary entry was
  created). If the daemon restarts inside that window, both the resumed Pi process and the
  rehydrated timeline consistently land back at the file's own leaf — consistent with each other
  and with TUI behavior. The tree view always shows the truth on next open.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Turn running | Selection disabled client-side; a raced RPC gets Pi's "wait for the current response" error → toast |
| Prompt from **another client** lands mid-summarizing-navigation | **Unguarded in MVP, accepted.** `navigateTree` checks `isStreaming` only at entry; a prompt arriving during the summary's LLM window starts a turn from the old leaf that the completing navigation then rebuilds context under. Requires a second concurrent client racing a seconds-wide window — possible (the daemon is multi-client) but rare, and a daemon-side per-agent guard would cut across the send path (`agent-service.ts`), not just this handler. Deferred; see TODO(verify) |
| Navigate to the current leaf | Pi returns `{cancelled: false}` no-op; treat as success, close dialog. The daemon broadcasts the reset anyway — the no-op is indistinguishable from a real move without an extra leafId round-trip, and resetting to identical rows is idempotent. One code path; do not special-case |
| Extension cancels (`session_before_tree`) | `{cancelled: true}` — no reset, no broadcast; toast |
| Summary LLM call fails after retries | RPC error → toast; leaf did NOT move (Pi throws before branching); dialog reusable |
| Summary aborted | `{cancelled: true, aborted: true}` → toast; nothing moved |
| Unknown `targetId` (tree stale — another client navigated/forked meanwhile) | Pi error "Entry … not found" → toast + refetch tree in place |
| Session driven concurrently by the TUI | Tree refetch-on-open keeps the view honest; a navigation against a stale tree hits the row above |
| `agents.providers.pi.command` overridden to an old Pi build | Daemon advertises `sessionTreeNavigate` (static per release) but the process rejects the command → clean RPC error → toast. Acceptable; noted, not gated |
| Huge tree | Previews daemon-truncated (~200 chars); node count is unbounded in MVP — virtualize the list client-side if profiling demands |
| Orphaned entries (broken parent chain) | Pi returns them as extra roots; render them under a dimmed "detached" group |
| Draft / dead / archived agent | Menu item hidden (no live session); RPC would return the standard no-session error |
| Old client + new daemon | Extra flags ignored; nothing rendered — additive by construction |
| `summarize: true` with no model selected | Pi throws "No model available for summarization" before moving the leaf → summary-failed toast; nothing moved |
| A fork happens while a tree pane is open | The fork's `agent_timeline_reset` broadcast must also refetch any open tree pane for that agent — the fork rebinds to a new session file, so the old tree is entirely wrong |
| Tree pane open on an agent that is archived/deleted | Pane shows the fetch-failure state (in-pane, not a toast — visual spec § 07, `- Pane`); tab stays closable |
| Tree tab persisted in a layout, reopened after reload | Rebuilt from tab identity like `file:`/`diff:` tabs and refetched on mount; a session that no longer exists lands in the fetch-failure state |

## Non-goals

- **File time-travel** — out of scope here for the same reason as in conversation-fork.md § Non-goals
  (it belongs in Pi's extension layer, e.g. Pi's own `git-checkpoint.ts`, not the daemon).
- Label editing outside `navigateTree`'s `label` option (no Pi RPC exists).
- Persisting the tree filter mode; parity with the TUI's *specific keybindings* (its fold/paging
  key set). Folding itself and the web tree's own keyboard model ARE in scope (visual spec § 06,
  `- Filters and Folding`, and the Phase 1 acceptance criteria).
- Live tree subscription/streaming; cross-session tree stitching (`parentSession` links from
  forks/clones).
- Branch-summary settings UI (`reserveTokens`, prompts) — Pi settings own this.

## Acceptance criteria

Phase 1:
- [ ] "Session tree…" opens a tree matching `get_tree` for a real branched session (one prepared
      via TUI `/tree` on a shared pi-home), active path highlighted, leaf marked, labels shown.
- [ ] Filter modes hide/show the right node kinds; a linear (never-branched) session renders as a
      single chain without visual noise.
- [ ] "Fork from here" on an active-branch user message runs the conversation-fork flow end to end.
- [ ] Tree tab: one per session, re-invoking the menu item focuses+refetches; splitting it beside
      the transcript survives a reload (layout identity round-trip).
- [ ] Fold defaults hold: abandoned branches folded, active path expanded and not foldable shut.
- [ ] Keyboard model works end to end (↑↓ ← → ⏎ F C Home End), one tab stop, `aria-current` on
      exactly one row; active path readable with color forced off.
- [ ] A fork performed elsewhere refetches an open tree pane for that agent.
- [ ] Feature invisible against a daemon lacking `sessionTree`.

Phase 2:
- [ ] Upstream `navigate_tree` merged/bundled; daemon advertises `sessionTreeNavigate`.
- [ ] Jumping to a prior user message truncates the transcript in **every** connected client
      (two-window live check), puts the text in the empty composer, and the next turn provably
      lacks the abandoned branch's context (real `pi` process).
- [ ] Jumping to an assistant/tool entry continues from that point with no composer prefill.
- [ ] A summarized navigation produces a visible summary row in the transcript and a
      `branch_summary` node in the tree on next open.
- [ ] Extension-cancelled and summary-aborted navigations change nothing and toast.
- [ ] Verified over the relay transport as well as direct WS.

## TODO(verify) — to resolve during implementation

- [x] ~~Whether the existing entry→row mapper tolerates `branch_summary`~~ — **resolved**: it does
      not (`session-hydration.ts:116-118` drops it), no compaction/summary row kind exists
      client-side (`row-model.ts`), and no text-bearing system event exists on the wire
      (`messages.ts`) — hence the `system_note` stream event; see § Public contract / § Behavior.
- [ ] `agent_compact_request`'s exact timeout handling (client + daemon) — inherit it verbatim for
      summarizing navigations.
- [ ] Whether Pi emits any RPC **event** on `navigateTree` (the `session_tree` emission goes to
      extensions; if nothing reaches the RPC event stream, the daemon's own broadcast is the only
      signal — assumed and designed for, verify live).
- [ ] Pi's actual behavior when a `prompt` command arrives while `navigateTree` is awaiting the
      summary LLM call (turn started from the old leaf vs. rejection). Decide at plan time whether
      a per-agent daemon guard is worth its cross-service footprint; unguarded is the documented
      MVP stance (§ Error handling).
- [ ] Upstream appetite/timeline for the `navigate_tree` PR; decide PR-vs-vendored-patch at plan
      time, not implement time.
