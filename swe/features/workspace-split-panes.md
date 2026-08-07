# Workspace Split Panes — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [workspace-ui.md](workspace-ui.md),
> [feature-panels-ui.md](feature-panels-ui.md), [terminals.md](terminals.md),
> [timeline-streaming.md](timeline-streaming.md),
> [keyboard-shortcuts.md](keyboard-shortcuts.md),
> [../architecture/persistence.md](../architecture/persistence.md)

## Purpose

Expands [workspace-ui.md](workspace-ui.md) § Pane / split model into an implementable contract for
the **drag-a-tab-to-split** gesture: how a drop position resolves to a split direction, how the
pane tree mutates, how dividers resize panes, how the arrangement is persisted per workspace, and —
most importantly — the **panel-continuity invariant** that keeps live terminals and streaming
conversations intact across every rearrangement.

The tab model itself (kinds, deterministic ids, open/close/focus/reorder) is defined in
[workspace-ui.md](workspace-ui.md) § Tab model and is not restated here.

## Public Contract

### Pane tree

| Node | Shape | Constraints |
|------|-------|-------------|
| Leaf pane | `{ kind: "leaf", id }` | `id` unique within a workspace's tree |
| Split | `{ kind: "split", direction, children, sizes }` | `direction` ∈ `row` \| `column`; `children.length ≥ 2`; `sizes` parallel to `children`, each finite and `> 0`, summing to `1` |

- One tree per workspace. A workspace with no splits is a **single leaf**, which is also the
  terminal state — a tree can never become empty.
- `row` lays children out **horizontally** (side by side); `column` lays them out **vertically**
  (stacked).
- **Maximum tree depth is 4**, consistent with [workspace-ui.md](workspace-ui.md). Depth counts
  nodes from the root: a lone leaf is depth 1; a leaf inside three nested splits is depth 4. Only
  a **nesting** split can exceed the cap — inserting a sibling into an existing same-direction
  run never increases depth and is always legal. How an invalid split surfaces depends on the
  entry point: the drag gesture degrades to a `center` move, programmatic affordances are
  disabled (see Splitting and Edge Cases).

### Tab ↔ pane assignment (invariant, not representation)

The contract is the invariant, not the data layout:

1. Every open tab belongs to **exactly one** leaf pane — never zero, never two.
2. Each pane has at most one **active tab**; that tab is the only one of its pane's tabs whose
   content is visible.
3. Tab order within a pane is stable and independently reorderable per pane.

[workspace-ui.md](workspace-ui.md) models this as a pane owning a list of tab ids plus a focused
tab id. Storing the owning pane id on each tab instead is equally valid; an implementation MUST
pick one owner so the invariant cannot be violated, and MUST NOT maintain both as independent
mutable state.

Exactly one pane per workspace is the **focused** pane; the focused pane's active tab is the
workspace's active tab (what close-current-tab and other tab-scoped commands act on). This must be
derived from, never stored alongside, the per-pane active tabs — a stored duplicate can drift and
point at an invisible tab.

### Drop regions

A drag over a pane's **content body** (not its tab strip) resolves to one of five regions:

| Region | Meaning | Resulting split direction | New pane position |
|--------|---------|---------------------------|-------------------|
| `left` | split, place dragged tab left | `row` | before target |
| `right` | split, place dragged tab right | `row` | after target |
| `top` | split, place dragged tab above | `column` | before target |
| `bottom` | split, place dragged tab below | `column` | after target |
| `center` | **move into** the target pane, no split | — | — |

The `center` region is mandatory, not decorative: without it a tab could never be moved into an
existing pane and panes could only ever accumulate.

#### Drag sources

The same five regions apply to a drag from any of four sources; only what the drop *opens* differs:

| Source | Dropped payload | Already open? |
|--------|-----------------|---------------|
| a tab in a pane's strip | that tab | always — move / split with it |
| a conversation row in the session list | that session | maybe — reuse its tab if so, else open one |
| a file row in the file tree | that path | maybe — reuse its tab if so, else open one |
| a file link or inline image in a chat message ([file-link-rendering.md](file-link-rendering.md), [inline-image-rendering.md](inline-image-rendering.md)) | that path | maybe — reuse its tab if so, else open one |

A sidebar drop whose payload has **no tab yet** MUST create the pane first (edge regions) and open
the tab directly into it, never into the dropped-on pane followed by a move — the intermediate state
is observable. A payload that **is** already open MUST route through the identical move/split path a
strip drag uses, including its no-op rules; a sidebar drag must not be able to duplicate a tab or to
produce an outcome its strip drag would refuse.

Two source-side restrictions exist because a drop target cannot inspect a drag's payload mid-gesture
(see § Error Handling & Edge Cases): a row belonging to a workspace other than the one in view, and a
directory row (there is no directory tab), MUST NOT advertise themselves as pane-droppable at all.
Refusing at drop time instead would preview an outcome that then does not happen.

These restrictions apply to *rows* — sources that know what they point at. A chat-message file link
([file-link-rendering.md](file-link-rendering.md)) performs no existence or type pre-check by
design, so it cannot honor the directory restriction; that accepted relaxation is documented in
that doc's § Known Limitations.

### Persisted layout record

One **versioned** record per client, holding an entry per workspace:

| Field | Meaning |
|-------|---------|
| `version` | Schema version; a mismatch discards the whole record |
| per workspace → `tree` | The pane tree (structure + sizes) |
| per workspace → `placement` | Map of **tab identity** → pane id |
| per workspace → `activeByPane` | Map of pane id → the **tab identity** of that pane's active tab |
| per workspace → `activePaneId` | Focused pane at save time |
| `activeWorkspaceCwd` | The workspace that was **in view** at save time (optional) |

Keyed by the same normalized workspace directory used elsewhere for workspace-scoped client state.
Per-client and local, like the rest of the layout state ([workspace-ui.md](workspace-ui.md) §
Per-client layout vs. global archive).

`activeWorkspaceCwd` is part of the layout, not a nicety: pane geometry is stored *per* workspace, so
without it restore has no idea which one to show and falls back to whatever the session inventory
happens to activate (this client: the most recently active agent). A user with two workspaces then
comes back to the wrong one — panes faithfully restored, wrong ones on screen, which is
indistinguishable from "my layout was lost" until they switch workspaces and watch the split appear
intact. It MUST be dropped on load if it names a workspace whose entry did not survive validation.

### Tab identity (distinct from tab id)

Layout MUST be persisted against a **stable cross-session identity**, not the transient tab id,
because some tab ids are not stable across a reconnect: a freshly created terminal tab is minted
with a client-local placeholder id before the daemon assigns its slot, whereas the same terminal is
re-opened next session under an id derived from that slot. Persisting raw tab ids therefore loses
every terminal's pane on reload.

| Tab kind | Identity | Persisted? |
|----------|----------|-----------|
| conversation / agent | `agent:<daemon-side agent id>` | yes, once the agent exists |
| file | `file:<absolute path>` | yes |
| diff | `diff:<staged-or-worktree flag>:<absolute path>` | yes |
| terminal | `terminal:<daemon-side slot/id>` | only once a slot exists |
| molecule | `molecule:<absolute path>` | only when file-backed |

Identity keys are **kind-prefixed** so two tab kinds over the same target — a `file` tab and a
`molecule` tab open on the same absolute path — can never collide in `placement`.

A tab with no identity (a terminal with no slot yet, an empty molecule tab) is simply omitted from
`placement` — there is nothing to restore it against.

A conversation's identity MUST be its **daemon-side agent id**, never a client-local session id.
A client that mints its own session ids per load (one per browser session, per reconnect) cannot
match them against a persisted record at all — the claim would never resolve and every conversation
pane would be pruned on reload, which is precisely the terminal-slot failure above in another
costume. The consequence is that a brand-new conversation whose agent-creation request has not yet
returned has **no** identity: its pane is not persisted until the id arrives, and acquiring that id
MUST trigger a write exactly as a terminal acquiring its slot does.

## Behavior & Algorithms

### Resolving a drop region

```
function resolveDropRegion(pointer, bodyRect):
    dx = (pointer.x - centerX(bodyRect)) / width(bodyRect)    # -0.5 .. +0.5
    dy = (pointer.y - centerY(bodyRect)) / height(bodyRect)
    if max(abs(dx), abs(dy)) < CENTER_BAND:                   # CENTER_BAND = 0.25
        return "center"
    if abs(dx) >= abs(dy):                                     # ties -> horizontal axis
        return dx < 0 ? "left" : "right"
    return dy < 0 ? "top" : "bottom"
```

`CENTER_BAND = 0.25` makes the central 50% of each axis a move-into-pane target and the outer band
a split target.

### Splitting

Two layers share the work: a pure tree mutation that refuses invalid splits, and the gesture
layer that never presents an invalid split in the first place.

```
function canSplit(tree, targetPaneId, region):
    direction = region in {left, right} ? "row" : "column"
    parent = parentOf(targetPaneId)
    if parent is a split with the SAME direction:
        return true                    # sibling insert into the run — depth unchanged
    return depthOf(tree, targetPaneId) + 1 <= MAX_DEPTH (4)     # nesting adds one level

function splitPane(tree, targetPaneId, region, newPaneId):
    if not canSplit(tree, targetPaneId, region):
        refuse                                     # no layout change at all
    direction = region in {left, right} ? "row" : "column"
    before    = region in {left, top}
    parent = parentOf(targetPaneId)
    if parent is a split with the SAME direction:
        # reuse the existing run instead of nesting deeper
        insert newPaneId as a sibling immediately before/after the target
        give it half the target's size; target keeps the other half
    else:
        replace the target leaf in place with a split node whose children are
        [new, target] if before else [target, new], sizes [0.5, 0.5]
```

The depth check MUST be evaluated per branch, after resolving whether the split reuses a
same-direction parent: a sibling insert never deepens the tree, so at maximum depth a split
along the run's own direction still succeeds; only the perpendicular (nesting) split is invalid.

Reusing a same-direction parent keeps repeated splits in one flat run, which both avoids
gratuitous depth (relevant against the depth cap) and makes sibling resizing behave as users
expect.

**The drag gesture never calls a refusing `splitPane`.** During hover it evaluates `canSplit`
for the resolved edge region; when false, the region **degrades to `center`** — the preview
shows the whole-pane move highlight and the drop performs the move. `splitPane`'s own refusal is
a backstop for programmatic callers and corrupted state, never a user-visible dead drop.

### Programmatic splits

[workspace-ui.md](workspace-ui.md) exposes non-drag entry points, defined here in terms of the
primitives above. Programmatic affordances are **disabled — never degraded — when `canSplit` is
false** for the implied region:

- **Split right / Split down** (tab-strip trailing actions): split-empty on the focused pane —
  `splitPane` with region `right` / `bottom`, then open a fresh draft tab
  ([workspace-ui.md](workspace-ui.md) § empty-workspace draft seeding) directly into the new
  pane. Works regardless of how many tabs the focused pane holds; nothing is moved, so nothing
  can collapse.
- **Split a tab to a side** (drag is the primary path): `splitPane` on the tab's own pane, then
  `moveTab` the tab into the new pane. Subject to the same only-tab no-op rule as the drag
  gesture.

Keyboard chords for these actions and for pane-focus navigation are scoped in
[keyboard-shortcuts.md](keyboard-shortcuts.md), not here.

### Removing a pane / collapsing

```
function removePane(tree, paneId):
    if paneId is the only leaf: return tree unchanged      # a workspace always has >= 1 pane
    drop the leaf from its parent's children
    redistribute its size PROPORTIONALLY across the remaining siblings
    if the parent split now has exactly one child:
        replace the parent with that child, which inherits the parent's slot and size
        if that child is itself a split with the SAME direction as its new parent:
            splice its children into the parent at that slot, scaling each spliced
            size by the inherited slot's size          # keep runs flat
    repeat the collapse upward while it applies
```

Collapse MUST preserve the flat-run property that splitting establishes. Without the splice
step, removing `B` from `row[A, column[B, row[C, D]]]` promotes `row[C, D]` directly into the
outer row, nesting same-direction splits — which wastes depth against the cap and changes
divider behavior. The splice restores `row[A, C, D]`.

### Moving a tab between panes

```
function moveTab(tabId, targetPaneId, beforeTabId):
    reassign the tab to targetPaneId, positioned before beforeTabId (or last if none)
    targetPaneId's active tab = tabId ; focus targetPaneId
    if the source pane lost its active tab: pick the nearest remaining sibling by index
    if the source pane is now empty:       removePane(source)
```

Splitting is defined in terms of this: create the new pane, then move the dragged tab into it. A
drop is a **no-op** when the dragged tab is the only tab of the pane being split — the new pane
would immediately collapse, so nothing should visibly happen.

### Geometry

Pane rectangles are pure arithmetic over the tree, expressed as fractions of the content area:
the root occupies the whole area, and a split divides its own rectangle along `direction` in
proportion to `sizes`. Dividers sit on interior boundaries: for a `row` split each boundary is a
vertical line at the cumulative-size offset spanning the split's own cross-axis extent, and
mirrored for `column`. A split with N children yields N−1 dividers.

### Resizing

```
function resizeAtDivider(tree, splitPath, boundaryIndex, deltaFraction):
    shift deltaFraction from children[boundaryIndex + 1] to children[boundaryIndex]
    clamp so BOTH neighbours stay >= MIN_PANE_FRACTION
    leave all other siblings untouched; sizes still sum to 1
```

Only the two panes adjacent to the dragged divider change size. `deltaFraction` is the pointer
delta along the split axis divided by the content area's extent on that axis.

`MIN_PANE_FRACTION = 0.1`. The minimum is a **resize** constraint, not a global invariant:
`splitPane` halves the target's size unconditionally, so a pane can legitimately be born below
the minimum after repeated splits. The clamp means a divider drag never *reduces* a neighbour
below the minimum; a neighbour already below it can only be grown.

### Restoring a persisted layout

Tabs are **not** themselves persisted. Daemon-owned ones are rebuilt from daemon state on connect
(restored conversations, running terminals), arriving asynchronously and in no guaranteed order;
client-side ones are reconstructed from their own claim keys (see below). Restore therefore must not
depend on ordering:

```
on client start:
    read the persisted record (synchronously, before first paint if possible)
    install each workspace's tree and sizes immediately        # geometry is correct up front
    focus `activePaneId` if it exists in the tree, else the first leaf
    hold `placement` / `activeByPane` as PENDING claims
    reopen every CLIENT-SIDE claim from its identity                # file / diff / molecule

on each tab open (whichever hook or user action creates it):
    identity = tabIdentity(tab)
    pane = first of:
        an explicitly requested pane that exists in the tree
        PENDING placement for this identity, if that pane still exists   # consume the claim
        the workspace's focused pane, if it still exists
        the tree's first leaf
    assign the tab to `pane`
    make it that pane's active tab UNLESS this came from a pending claim and either
        `activeByPane` names a DIFFERENT identity for that pane, or
        the pane's active tab was already set by a direct user action   # never steal focus
```

This is what makes restore robust: each pane comes back showing the tab it had, regardless of
which tabs arrive first, and no separate "apply layout after restore finishes" step is needed.
A claim-driven arrival never overrides the user: if the user explicitly focused or opened a tab
in a pane while restore was still in flight, a later-arriving claimed tab joins that pane
without becoming its active tab.

A pane no tab has claimed **yet** renders as if absent — geometry treats it exactly as if
`removePane` had run, redistributing its fraction proportionally, without mutating the stored
tree. Pruning is tied to a settle point: **initial hydration complete**, the moment the daemon's
connect-time inventories (restored conversations, running terminals) have been fully applied. At
that point all unconsumed pending claims are discarded and every unclaimed pane is removed from
the stored tree via `removePane`. Before that point an unclaimed pane is NEVER pruned — restore
is asynchronous, and closing some other tab early must not destroy the pane of a terminal whose
daemon listing simply has not arrived yet.

The settle point is also when the **view** is restored: the client switches to `activeWorkspaceCwd`,
which brings that workspace's focused pane and per-pane active tabs with it. It MUST wait for the
settle point rather than acting on the first arriving tab, because every tab open brings its own
workspace into view, so an earlier switch would simply be overwritten by the next arrival. It MUST be
a one-shot, so a user who switches workspaces during restore is never yanked back. And it MUST be
skipped when that workspace has no restored tab at all — landing on an empty workspace whose sessions
were all deleted is worse than staying where restore put you.

A claim can only be consumed by a tab that actually opens, so each restore source MUST open every
entity whose identity appears in the pending claims — **not** just the subset it would open with no
record present. A client that restores only, say, the most recent conversation leaves every other
conversation's claim unconsumed, and a two-conversation split comes back single-paned with the second
pane pruned. The record therefore *widens* what restore opens; it never narrows it, and a claim that
matches nothing the daemon still knows about simply expires at the settle point. Claims in a
**background** workspace count too — a workspace the user is not currently viewing must still come
back split when they switch to it.

Tab kinds split into two groups by **who owns the thing the tab shows**, and each group is restored
differently:

- **Daemon-owned** (conversation, terminal). The daemon's connect-time inventory is the source of
  truth: the client opens what the daemon still lists, and a conversation or terminal destroyed since
  the last load correctly stays closed. Its claim expires at the settle point.
- **Client-side** (file, diff, molecule view). Nothing on the daemon knows these exist — they are
  views of a path — so no inventory can rebuild them, and without a replay their claims always expire
  and their panes are always pruned: two files side by side collapse to one pane on every reload.
  The client MUST therefore reopen them from the record itself, at install time. No extra persisted
  state is required, because the identity already *is* the descriptor (`file:<path>`,
  `diff:<flag>:<path>`, `molecule:<path>`); the reconstruction MUST be the exact inverse of the
  identity function, so that the reopened tab's identity matches the claim it is meant to consume.
  Reopening is synchronous and needs no connection: a path-backed panel fetches its content when a
  client appears.

An identity whose prefix the client does not recognise MUST be ignored rather than guessed at — a
record written by a newer client can name kinds this one has never heard of.

## Panel continuity invariant (critical)

**Rearranging panes MUST NOT destroy, recreate, or tear down a panel's content instance, and MUST
NOT detach its subscriptions.** This is the single hardest requirement in this feature and it
constrains the rendering strategy.

Why it is load-bearing:

- A **terminal** panel owns a live subscription to a daemon-side PTY, and its teardown path is what
  terminates that PTY. Destroying the panel because the user dragged its tab into a new pane would
  kill the user's shell and any long-running process in it.
- A **conversation** panel holds a per-panel subscription to its agent event stream. Two concurrent
  instances for one session would apply every streamed event twice, duplicating timeline rows.
- Composer draft text, pending attachments, and scroll position are panel-local; recreating the
  panel silently discards them mid-conversation.

Two rendering strategies satisfy the invariant:

1. **Flat host + computed rectangles** — all panels remain siblings in one stable container and are
   positioned at their pane's computed rectangle. A rearrangement changes only geometry, so no
   panel is ever moved in the render tree.
2. **Stable per-tab content element** — content is rendered into a per-tab container that is
   *re-inserted* into the destination pane rather than rebuilt, so instance identity survives the
   move.

**Forbidden:** rendering panel content as a structural child of its pane node such that changing
the tree recreates the panel. This is the intuitive implementation and it is wrong; it fails every
acceptance criterion in the Streams section below.

Consequences an implementation must honor:

- A pane resize MUST reach size-sensitive panels so they can re-measure. A terminal must recompute
  its character grid and report the new row/column count upstream, or its output wraps at a stale
  width ([terminals.md](terminals.md)).
- Becoming visible (its pane's active tab changing to it) MUST also trigger that re-measure, since
  a hidden panel may have had no measurable size. Note that with splits, a panel can be **visible
  without being the workspace's active tab** — it is the active tab of a non-focused pane — so
  visibility must be evaluated per pane, not against the single workspace-active tab.
- **Keepalive / eviction:** the continuity invariant subsumes the mounted-tab LRU described in
  [workspace-ui.md](workspace-ui.md) § Mounted-tab keepalive. A panel that is any pane's active
  tab is visible and MUST NOT be evicted, and a live terminal panel MUST NEVER be evicted
  regardless of recency — its unmount path is what kills the PTY. The current web-client's
  `TabPanelHost` keeps every open tab's panel mounted (no LRU exists), satisfying this trivially;
  an implementation MAY bound warm *hidden, non-terminal* panels per pane, but any such cap is an
  optimization detail, never permission to violate the invariant.

## Data & Persistence

- Layout record: per-client, local, versioned, keyed per workspace; written on a short trailing
  debounce after any layout mutation rather than synchronously per drag frame. **Acquiring a tab
  identity counts as a mutation** for this purpose: when a terminal's daemon slot arrives, the
  record must be rewritten — otherwise a terminal placed by drag and never touched again loses
  its pane on reload.
- **A write MUST preserve unconsumed claims.** The record is otherwise a projection of *live* tabs, so
  a write that lands during the restore window — and the client-side tab replay causes one immediately
  — would persist a record describing only the tabs already open, silently dropping every pane whose
  conversation or terminal is still in flight. The next load then has geometry with no claims, and the
  settle point prunes exactly those panes: the split collapses one reload later, with no user action
  and nothing to point at. Serialization therefore layers live tabs *over* the still-pending claims;
  once hydration settles the pending set is empty and the record is a pure live projection again.
- On load, `sizes` are renormalized to sum to 1 (float drift across save/load cycles is
  expected); only structural damage discards an entry (see Edge Cases).
- Nothing about splits is sent to or stored on the daemon. Panes are a client presentation concern;
  agents, terminals, and files are unaffected by how they are arranged.
- See [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| Drop in the `center` region | Tab moves into the target pane; no split |
| Drop where the dragged tab is the target pane's only tab | No-op; no split, no visible change |
| Split would exceed depth 4 | Only a **nesting** split can exceed the cap — a sibling insert into a same-direction run is always legal. For the drag gesture the edge region **degrades to `center`**: the tab moves into the target pane instead of splitting it. The drop preview must apply the same degradation, showing the whole-pane move highlight rather than a half-pane split preview — so what the user sees is always what happens. A split is never silently performed nor silently dropped |
| Programmatic split while `canSplit` is false | The affordance is disabled; nothing happens. Programmatic entry points never degrade |
| Divider dragged past a neighbour's minimum | Clamped at the minimum; neither neighbour collapses to zero. A neighbour already below the minimum (born from a split) can only be grown |
| Last tab in a pane closed, other panes exist | Pane is removed; its space is redistributed proportionally; focus moves to a surviving pane |
| Last tab in the *only* pane closed | Pane is kept and renders the workspace's empty state |
| Persisted record has an unknown/newer `version` | Whole record discarded; every workspace starts as a single pane |
| Persisted tree malformed (size/child count mismatch, duplicate pane ids, non-finite or non-positive sizes) | That **workspace's** entry is discarded and it starts as a single pane; other workspaces are unaffected. Sizes that merely drift from summing to 1 are renormalized on load, not treated as damage |
| Persisted placement names a pane absent from the tree | Tab falls back to the focused pane, else the first leaf |
| A persisted pane is never claimed by any tab | Rendered as absent (geometry redistributes its fraction); once initial hydration completes, unconsumed claims are dropped and unclaimed panes are removed from the stored tree |
| Tab closed or moved while restore claims are outstanding | Normal behavior — but a pane with an outstanding PENDING claim is never pruned by it |
| Drag released outside any pane or strip | No change |
| Sidebar row dragged over a pane, and its payload is already open there | Same no-op rules as a strip drag: `center` on its own pane, or a split off its pane's only tab, does nothing |
| Sidebar row's target workspace is not the one in view | Not pane-droppable; no preview, no drop. Panes belong to one workspace's layout, and a drag's payload is unreadable mid-gesture, so this is enforced at the source |
| Directory row dragged over a pane | Not pane-droppable (no directory tab); its row-to-row move remains available |
| OS file dragged over a pane | Ignored; a pane is not an upload target. Only the file tree accepts OS file drops |
| Sidebar row dragged onto a pane whose edge split is illegal | Degrades to `center` exactly as a strip drag does — one shared resolution, so both previews match their outcome |
| Dropped session no longer exists | Nothing opens; the stale row is simply inert |
| Switching workspaces | Each workspace keeps its own tree; panels of other workspaces stay alive (they must not be torn down — see the continuity invariant) |

## UI Behavior

- Every pane renders **its own tab strip**; all strips are the same height as the surrounding
  header chrome.
- While dragging over a pane body, an **indicator** previews the outcome: the half of the pane the
  new pane will occupy for an edge region, or the whole pane for `center`.
- Dropping on another pane's **tab strip** moves the tab into that pane (same as `center`).
  Dropping directly on a **tab** moves/reorders at that tab's position, within or across panes.
- Dividers show an axis-appropriate resize cursor and are a few pixels wide with a hover
  affordance; they overlay the boundary rather than consuming layout space.
- The focused pane is visually indicated.
- Each pane's "new tab" affordance opens into **that** pane.
- A single pane must be visually indistinguishable from a workspace that has no split support at
  all — no divider, no extra chrome.

## Dependencies

- Internal: tab model and panel registry ([workspace-ui.md](workspace-ui.md)), per-panel UIs
  ([feature-panels-ui.md](feature-panels-ui.md)), terminal stream + resize
  ([terminals.md](terminals.md)), agent stream subscriptions
  ([timeline-streaming.md](timeline-streaming.md)), local client persistence.
- External: a pointer-based drag-and-drop mechanism able to span every pane's strip and body within
  **one** drag context — a single gesture cannot begin in one drag system and finish in another.
- Connect-time restore hooks — **already present**, not net-new work: conversations restore via
  `use-session-restore.ts` and running terminals via `use-terminal-restore.ts`
  (`list_terminals_request` → one tab per live slot, opened with the slot already known so
  `TerminalPanel` re-subscribes to the existing PTY instead of spawning a second one —
  [terminals.md](terminals.md) § Restore / snapshot). Both are **one-shot per connection**, which
  is what makes the *initial hydration complete* settle point above implementable: hydration is
  complete once both have run. A freshly created terminal tab carries no slot until the daemon
  assigns one — precisely why layout persists identities rather than tab ids.

## Acceptance Criteria

- [ ] Dropping a tab on the left/right/top/bottom of another pane's body splits that pane in the
      matching direction, with the dragged tab in the new pane on the dropped side.
- [ ] Dropping a tab in the central band of another pane's body moves it into that pane without
      splitting.
- [ ] Splitting the same direction repeatedly produces one flat run of sibling panes, not nested
      pairs.
- [ ] Dragging a divider resizes only its two adjacent panes and cannot collapse either below the
      minimum fraction.
- [ ] Closing the last tab of a pane removes that pane and redistributes its space; closing the
      last tab of the only pane leaves an empty pane rather than an empty tree.
- [ ] At depth 4, a perpendicular edge drop degrades to a move into the target pane with a
      matching preview, while a drop along the run's own direction still splits as a sibling
      insert — no tree deeper than 4 is ever produced.
- [ ] Removing a pane never leaves a same-direction split nested inside a same-direction parent —
      collapse splices runs flat.
- [ ] Split right / Split down seed a draft tab in the new pane and are disabled (not degraded)
      when `canSplit` is false.
- [ ] **Streams:** a terminal running continuous output keeps streaming without interruption while
      its own tab, or another tab, is dragged to create a split — and its PTY is still alive
      afterwards.
- [ ] **Streams:** a conversation actively receiving streamed output continues to stream during and
      after a split, with no duplicated rows.
- [ ] **State:** unsent composer text and scroll position survive a split, a move between panes, and
      a divider resize.
- [ ] **Resize:** after a pane resize, a terminal reflows to the new character grid and reports the
      new dimensions upstream.
- [ ] **Restore:** after a reload and reconnect, pane geometry, divider proportions, each pane's tab
      set, and each pane's active tab are all restored — including terminals, which reattach to
      their existing PTYs rather than spawning new shells.
- [ ] **Restore is order-independent:** the same arrangement results regardless of the order in
      which restored conversations and terminals arrive.
- [ ] **Restore never steals focus:** a claim-driven arrival never displaces a tab the user
      explicitly activated in that pane while restore was in flight.
- [ ] A corrupt or version-mismatched layout record degrades to a single pane holding that
      workspace's tabs, with no error surfaced to the user.
- [ ] With one pane, tab reorder, middle-click close, close-tab and new-tab shortcuts, and
      workspace switching all behave exactly as they do without split support.

## TODO(verify)

- [ ] Whether split arrangements should be shareable/synced across clients; currently specified as
      strictly per-client like the rest of the layout state.
