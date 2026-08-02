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
- **Maximum tree depth is 4**, consistent with [workspace-ui.md](workspace-ui.md). A split that
  would exceed it is refused (see Edge Cases).

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

### Persisted layout record

One **versioned** record per client, holding an entry per workspace:

| Field | Meaning |
|-------|---------|
| `version` | Schema version; a mismatch discards the whole record |
| per workspace → `tree` | The pane tree (structure + sizes) |
| per workspace → `placement` | Map of **tab identity** → pane id |
| per workspace → `activeByPane` | Map of pane id → the **tab identity** of that pane's active tab |
| per workspace → `activePaneId` | Focused pane at save time |

Keyed by the same normalized workspace directory used elsewhere for workspace-scoped client state.
Per-client and local, like the rest of the layout state ([workspace-ui.md](workspace-ui.md) §
Per-client layout vs. global archive).

### Tab identity (distinct from tab id)

Layout MUST be persisted against a **stable cross-session identity**, not the transient tab id,
because some tab ids are not stable across a reconnect: a freshly created terminal tab is minted
with a client-local placeholder id before the daemon assigns its slot, whereas the same terminal is
re-opened next session under an id derived from that slot. Persisting raw tab ids therefore loses
every terminal's pane on reload.

| Tab kind | Identity | Persisted? |
|----------|----------|-----------|
| conversation / agent | its session or agent id | yes |
| file | its absolute path | yes |
| diff | its absolute path + staged-vs-worktree flag | yes |
| terminal | its daemon-side terminal slot/id | only once a slot exists |
| molecule | its absolute path | only when file-backed |

A tab with no identity (a terminal with no slot yet, an empty molecule tab) is simply omitted from
`placement` — there is nothing to restore it against.

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

```
function splitPane(tree, targetPaneId, region, newPaneId):
    if depthOf(tree, targetPaneId) would exceed MAX_DEPTH (4) after the split:
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

Reusing a same-direction parent keeps repeated splits in one flat run, which both avoids
gratuitous depth (relevant against the depth cap) and makes sibling resizing behave as users
expect.

### Removing a pane / collapsing

```
function removePane(tree, paneId):
    if paneId is the only leaf: return tree unchanged      # a workspace always has >= 1 pane
    drop the leaf from its parent's children
    redistribute its size PROPORTIONALLY across the remaining siblings
    if the parent split now has exactly one child:
        replace the parent with that child, which inherits the parent's slot and size
    repeat the collapse upward while it applies
```

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

### Restoring a persisted layout

Tabs are **not** themselves persisted — they are rebuilt from daemon state on connect (restored
conversations, running terminals), arriving asynchronously and in no guaranteed order. Restore
therefore must not depend on ordering:

```
on client start:
    read the persisted record (synchronously, before first paint if possible)
    install each workspace's tree and sizes immediately        # geometry is correct up front
    hold `placement` / `activeByPane` as PENDING claims

on each tab open (whichever hook or user action creates it):
    identity = tabIdentity(tab)
    pane = first of:
        an explicitly requested pane that exists in the tree
        PENDING placement for this identity, if that pane still exists   # consume the claim
        the workspace's focused pane, if it still exists
        the tree's first leaf
    assign the tab to `pane`
    make it that pane's active tab UNLESS this came from a pending claim and
        `activeByPane` names a DIFFERENT identity for that pane
```

This is what makes restore robust: each pane comes back showing the tab it had, regardless of
which tabs arrive first, and no separate "apply layout after restore finishes" step is needed.

A pane that no tab ever claims (its conversation was deleted between sessions) renders as if
absent — geometry is computed over occupied panes only — and is permanently dropped from the
stored tree the next time any tab is closed or moved.

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

## Data & Persistence

- Layout record: per-client, local, versioned, keyed per workspace; written on a short trailing
  debounce after any layout mutation rather than synchronously per drag frame.
- Nothing about splits is sent to or stored on the daemon. Panes are a client presentation concern;
  agents, terminals, and files are unaffected by how they are arranged.
- See [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| Drop in the `center` region | Tab moves into the target pane; no split |
| Drop where the dragged tab is the target pane's only tab | No-op; no split, no visible change |
| Split would exceed depth 4 | The edge region **degrades to `center`**: the tab moves into the target pane instead of splitting it. The drop preview must apply the same degradation, showing the whole-pane move highlight rather than a half-pane split preview — so what the user sees is always what happens. A split is never silently performed nor silently dropped |
| Divider dragged past a neighbour's minimum | Clamped at the minimum; neither neighbour collapses to zero |
| Last tab in a pane closed, other panes exist | Pane is removed; its space is redistributed proportionally; focus moves to a surviving pane |
| Last tab in the *only* pane closed | Pane is kept and renders the workspace's empty state |
| Persisted record has an unknown/newer `version` | Whole record discarded; every workspace starts as a single pane |
| Persisted tree malformed (size/child count mismatch, duplicate pane ids, non-finite sizes) | That **workspace's** entry is discarded and it starts as a single pane; other workspaces are unaffected |
| Persisted placement names a pane absent from the tree | Tab falls back to the focused pane, else the first leaf |
| A persisted pane is never claimed by any tab | Not rendered; pruned from the stored tree on the next close/move |
| Drag released outside any pane or strip | No change |
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
- [ ] At depth 4, an edge drop degrades to a move into the target pane, and the preview shows that
      move rather than a split — no tree deeper than 4 is ever produced.
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
- [ ] A corrupt or version-mismatched layout record degrades to a single pane holding that
      workspace's tabs, with no error surfaced to the user.
- [ ] With one pane, tab reorder, middle-click close, close-tab and new-tab shortcuts, and
      workspace switching all behave exactly as they do without split support.

## TODO(verify)

- [ ] Interaction with the mounted-tab keepalive policy: [workspace-ui.md](workspace-ui.md)
      § Mounted-tab keepalive specifies an LRU cap of 3 warm tabs, but the continuity invariant
      above requires that a panel visible in *any* pane is never evicted, and that a live terminal
      is never evicted regardless of recency. Confirm whether the cap applies per pane, is raised,
      or is bypassed for panes and live streams.
- [ ] Whether split arrangements should be shareable/synced across clients; currently specified as
      strictly per-client like the rest of the layout state.
