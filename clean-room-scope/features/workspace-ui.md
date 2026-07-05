# Workspace UI — Panes, Tabs & Layout — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [app-navigation-screens.md](app-navigation-screens.md),
> [composer-ui.md](composer-ui.md), [timeline-rendering.md](timeline-rendering.md),
> [feature-panels-ui.md](feature-panels-ui.md), [subagents.md](subagents.md),
> [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md)

## Purpose

Defines the main workspace screen: how the primary header, tab strip, tiled pane content, explorer
sidebar, and composer compose; the **tab model** (kinds, deterministic ids, open/focus/close/rename/
reorder, per-client layout vs. global archive, mounted-tab keepalive); the **pane/split model** (single
pane, web drag-and-drop splits, focus, resize); and the workspace header actions (branch switcher, scripts,
open-in-editor, bulk close, empty-workspace draft seeding). The per-panel UIs (agent stream, terminal,
browser, file, git) are in [feature-panels-ui.md](feature-panels-ui.md) and
[timeline-rendering.md](timeline-rendering.md).

## Public Contract

### Identity & state keys
- A workspace is `(serverId, workspaceId)`. Most workspace UI state is keyed by a **persistence key**
  `"${serverId}:${workspaceId}"`.
- **Layout store** (per-client, persisted locally) is the live source of truth for the split tree, focus,
  pin/hide, and split sizes. A separate flat tabs store mirrors order/focus. `TODO(verify)`: the exact
  runtime division of labor between the two — the screen wires open/close/focus from the layout store.
- Workspace execution authority resolves the workspace directory (cwd) and `projectKind` (`git`/`non_git`);
  panels render a "directory not found" state if unavailable.

### Tab model
A tab = `{ tabId, target, createdAt }`. The UI works with a descriptor `{ key, tabId, kind, target }`.

| Kind | Target shape | Panel | Deterministic tabId | Default label |
|------|--------------|-------|---------------------|---------------|
| `draft` | `{ draftId, setup? }` | agent-conversation (draft) | `draftId` | "New Agent" |
| `agent` | `{ agentId }` | agent-conversation (agent) | `agent_${agentId}` | "Agent" |
| `terminal` | `{ terminalId }` | terminal | `terminal_${terminalId}` | "Terminal" |
| `browser` | `{ browserId }` | browser | `browser_${browserId}` | "Browser" |
| `file` | `{ path, lineStart?, lineEnd? }` | file preview | `file_${path}` | filename(path) |
| `setup` | `{ workspaceId }` | setup | `setup_${workspaceId}` | "Setup" |

- **Deterministic ids** mean re-opening the same target re-focuses the existing tab instead of duplicating.
- A `draft` tab **mutates in place into an `agent` tab** once the agent is created (they share one panel
  component). Draft `setup` carries `{ provider, cwd, modeId?, model?, thinkingOptionId?, featureValues? }`
  and participates in target equality.
- A **panel registry** maps `kind → { component, useDescriptor, confirmClose? }`. The descriptor
  (`{ label, subtitle, titleState, icon, statusBucket }`) drives the tab chip's label/icon/status dot;
  agent descriptors compute a status bucket (`needs_input | failed | running | attention`) → colored dot
  and a loading skeleton title; browser descriptors use live favicon/title.
- Each rendered panel receives a **pane context** (`serverId, workspaceId, tabId, target, openTab,
  closeCurrentTab, retargetCurrentTab, openFileInWorkspace, openImportSheet`) and a **pane focus context**
  (`isWorkspaceFocused, isPaneFocused, isInteractive = both, focusPane`).

## Behavior & Algorithms

### Top-level layout (center column, top→bottom)
1. **Primary screen header** — shown unless focus mode is on (always shown on mobile). Left = sidebar
   toggle + workspace title bar; right = the action cluster.
2. **Tab strip** — branches by form factor (below).
3. **Pane content area** — mobile gesture surface, or the split container (web), or a single-pane fallback.
The center column is flanked (wide) by the **explorer sidebar** when shown and a workspace directory
exists. The whole content is wrapped in a workspace-focus provider keyed by the persistence key, and
mounts the import-session sheet and the tab-rename modal at the root.

### Tab operations
| Action | Notes |
|--------|-------|
| Open focused | add to focused pane + focus; un-hide if `agent` |
| Open child | also records `parentTabId` for the child |
| Open background | add without focusing |
| Close | remove from tree; collapse empty panes; next focus = last remaining tab in order |
| Focus | set focused tab |
| Retarget | mutate target in place (draft→agent) |
| Reorder | within the focused pane or a specific pane |

- **Tab context menu** (right-click desktop / `⋯` mobile): agent-only "Copy resume command", "Copy agent
  id", "Reload agent"; agent/terminal "Rename"; universal "Close to the left/right (or above/below on
  mobile)", "Close other tabs", "Close" (disabled appropriately at list ends/singletons). Middle-click
  closes a tab (web).
- **Rename** applies only to agent + terminal tabs (adaptive rename modal at workspace root).

### Reconciliation: tabs follow the backend
A reconciler keeps tabs in sync with backend reality from a snapshot (`agentsHydrated`, `terminalsHydrated`,
`activeAgentIds`, `autoOpenAgentIds`, `knownAgentIds`, `knownTerminalIds`, `standaloneTerminalIds`,
`hasActivePendingDraftCreate`):
- De-duplicate tabs for the same canonical entity (prefer a canonical keeper id).
- Collapse stale tabs (agent tabs not visible, terminal tabs not known) once hydrated.
- Add missing tabs (auto-open agents, standalone terminals).
- Apply per-client **pin/hide** sets (pinned forces visible; hidden suppresses).
- An agent belongs to the workspace when its normalized cwd equals the workspace directory; non-archived →
  active; auto-open per policy. **Archiving an agent (global/server-side) prunes its tab on all clients.**

### Per-client layout vs. global archive (key distinction)
- **Tabs/layout/pin/hide/split tree are per-client**, persisted locally (the layout store persists only the
  per-workspace layout + split sizes; pin/hide/focus-restoration are not persisted).
- **Archive is global/server-side.** Closing an agent **tab** ≠ archiving (subagent tabs are layout-only;
  root-agent tab close archives — see [subagents.md](subagents.md)). Bulk-closing agent/terminal tabs DOES
  close/archive on the daemon.

### Mounted-tab keepalive (LRU)
A small LRU set (cap 3) keeps recently-active tabs **mounted but hidden** (hidden style +
pointer-events-none) so switching back is instant and background tabs (terminals, streams) keep state. The
active tab is always first. Applied per pane (web) and for the focused pane (mobile/non-web desktop).

### Pane / split model
- Data: `SplitPane { id, tabIds, focusedTabId }`, `SplitGroup { id, direction, children, sizes }`, a node
  tree, with `focusedPaneId` and a `parentTabId` map. Default = single pane `"main"`. Max tree depth 4.
- **Active-tab derivation per pane:** order by the pane's `tabIds`, normalize/dedup, choose active with
  precedence preferred-target → pane focused → first.
- **Split operations:** split a tab into a new pane on a side (left/right/top/bottom), split empty (seeds a
  draft), move a tab between panes (empty source collapses), focus/unfocus with a focus-restoration token
  (so a transient unfocus from a modal/popover can be restored), resize (persist drag proportions, clamped
  to a minimum).
- **Split container (web only):** recursively renders the node tree with resize handles; each pane has its
  **own tab strip** + mounted content. A single drag context spans all panes and supports reorder within a
  pane, move to another pane, and **split by dropping on a pane's edge drop-zones**, with an insertion
  preview and a floating drag overlay chip. Clicking inside a pane focuses it (unless the click hit an
  interactive element); the focused pane shows an accent indicator. **Focus mode** (desktop) hides the
  screen header and emphasizes the focused pane.
- **Non-web desktop fallback** (touch tablet on desktop shell): a single tab strip for the focused pane,
  no DnD splitting (split actions hidden).

### Desktop tab strip
- Height 36. Per-tab widths distributed between an icon-only minimum and a 200px max; if even icon-only
  doesn't fit, enable horizontal scroll. Labels truncate by width; loading tabs show a skeleton bar.
- Each chip: icon (+ status dot), label, close button (always when policy = all), wrapped in a context menu
  + tooltip; active tab shows the accent indicator. Reorder via a sortable inline list with a drag handle
  (the split container's shared drag context owns cross-pane drags).
- Trailing actions cluster: New agent tab, New terminal tab (disabled while creating), New browser tab
  (Electron only), and — when splits are supported — Split right / Split down. Keyboard chords shown in
  tooltips.

### Mobile (compact) tab UI
No tab strip. A single switcher trigger shows the active tab's icon + label + chevron; tapping opens a list
of all tabs (each with a `⋯` menu using the same menu builder). The content area uses an edge-swipe surface
to open the explorer. No pane splits on phone.

### Primary header
- **Left:** sidebar toggle + workspace title bar. The title bar shows a skeleton while loading, else a
  **branch switcher** (title + current git branch; branch suppressed when HEAD/detached) and an optional
  project subtitle (hidden when it equals the title, case-insensitive). It hosts the workspace actions `⋯`
  menu: New agent, New terminal (disabled when not ready), New browser tab (Electron), Import session, Copy
  workspace path (absolute only), Copy branch name (when present), Show setup (when applicable).
- **Right (wide):** scripts button (when scripts exist), open-in-editor split button (when a workspace dir
  exists), and for git checkouts the git actions + an explorer toggle showing a source-control icon and a
  diff-stat; non-git shows a plain explorer toggle. Buttons collapse to icon-only at narrow widths. Mobile
  shows just the explorer toggle (and inlines the scripts button into the title-bar menu).

### Scripts button
Renders only when the workspace has scripts. Split presentation on desktop (primary action + dropdown),
ghost icon on mobile. Each script row offers **Start** or **View** (when its terminal is already live) and
may expose a service URL (open in a browser tab / external). Starting a script focuses/opens its terminal
tab; opening a URL opens a browser tab. Errors toast.

### Open-in-editor
Web-only and only when the cwd is absolute. Computes targets from desktop open targets (Electron + local
execution), a GitHub link (from checkout status), and the active file. Split button: primary opens the
**preferred editor**; the caret dropdown lists all targets (check on preferred, persists a new preference).
GitHub targets open externally; editor targets open via the desktop bridge; the active file tab opens that
specific file.

### Bulk close
Classify tabs into agent/terminal/other. Build a confirmation distinguishing **archive** (agents) vs
**close** (terminals/others, warning processes stop). On confirm, call the daemon to close/archive
agents+terminals server-side, then close each tab locally with cleanup. Track closing tab ids to show a
spinner and prevent double-close. The agent close-vs-archive policy comes from the subagents policy (root
agents archive on close; subagent tabs are layout-only).

### Empty-workspace draft seeding
When everything is hydrated/ready (route focused, persistence key + workspace dir present, layout + agents +
terminals loaded) and the workspace is genuinely empty (0 active agents, 0 terminals, 0 tabs), open a fresh
draft tab (a "New Agent" composer) so an empty workspace always lands on something usable. The draft setup
maps to an agent-session config; the draft composer auto-focuses when its pane is focused and not submitting.

### Pinned quick-launch targets
A small client-local set of "pinned" tab kinds drives one-tap quick-launch buttons shown alongside the
empty-workspace draft seed and in the mobile new-tab picker:
```ts
type PinnedTabTarget =
  | { kind: "draft" }                        // a new agent draft, using default create-agent preferences
  | { kind: "terminal" }                      // a new terminal
  | { kind: "browser" }                       // a new browser tab (Electron)
  | { kind: "profile"; profileId: string };   // a saved create-agent-preferences profile (see composer-ui.md)
```
- **Defaults:** `terminal` and `browser` are pinned out of the box; `draft`/named profiles are opt-in.
- **Persistence:** a small versioned client store (`pinned-tab-targets`, migrated across versions so a
  v0 shape without defaults is backfilled with the default set on first load).
- **Toggle:** `togglePinnedTarget` adds a target if absent, removes it if already pinned, keyed by
  `pinnedTargetKey` (`draft` / `terminal` / `browser` / `profile:<id>`).
- **Launch:** tapping a pinned quick-launch button opens the corresponding tab kind directly (a
  `profile` target opens a draft pre-filled from that saved create-agent-preferences profile) via the
  same open-tab path as the tab strip's "New agent/terminal/browser" actions.
- **Menu:** each pinnable surface (tab-strip "new" menu, empty-workspace quick actions) exposes a
  "Pin"/"Unpin" toggle item per target kind.

### Route gating
Resolve a route state from host/connection/workspace/hydration: `ready` (workspace present + online),
`reconnecting` (present, not online), `unreachable` (no workspace, not online), `loading` (online, not
hydrated), `missing` (online, hydrated, no such workspace). Non-`ready` renders a minimal gate shell with
actions: retry host, manage host (settings), dismiss missing workspace. A missing execution directory shows
a distinct empty state.

### Composer integration
The composer lives inside the agent/draft panel, not the workspace shell: a stream section over a composer
section, with a **subagents track** above the composer and an archived-agent callout replacing the composer
for archived agents. Compact composer layout is chosen per-container (below the 500px threshold). See
[composer-ui.md](composer-ui.md).

## Data & Persistence
- Per-workspace: layout (split tree) + split sizes, explorer expanded paths, diff expanded paths, review
  drafts, sort options — client-local stores. Tabs are NOT global. See
  [persistence.md](../architecture/persistence.md).
- Pinned quick-launch targets: a small versioned client store (`pinned-tab-targets`), global (not
  per-workspace), migrated forward across versions.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Workspace not online | Reconnecting/unreachable gate shell with retry/manage actions |
| Workspace id unknown after hydration | "Missing workspace" gate + dismiss |
| Execution directory missing | Distinct empty state; panels show "directory not found" |
| Agent archived elsewhere | Its tab is pruned on all clients after hydration |
| Closing the last tab | Empty pane collapses; empty workspace re-seeds a draft |
| Split depth would exceed 4 | Split refused |
| Pinned profile target's saved profile is deleted | TODO(verify) — likely falls back to a plain draft |

## Dependencies
- Pinned library versions: see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack.
- Internal: panel registry + per-panel features, layout/tabs stores, workspace execution authority, git
  checkout status, subagents policy, composer, design system, create-agent preferences (pinned profile
  targets — see [composer-ui.md](composer-ui.md) § Create-agent preferences).
- External: drag-and-drop (web pane splits), local persistence.

## Acceptance Criteria
- [ ] Re-opening an existing target re-focuses its tab (deterministic ids); a draft tab becomes an agent tab
      in place on creation.
- [ ] Tabs/layout persist per client; archiving an agent prunes its tab on all clients.
- [ ] Web supports drag reorder, cross-pane move, and edge-drop splitting up to depth 4; non-web desktop and
      mobile do not split.
- [ ] The mounted-tab LRU keeps ≤3 tabs warm; background terminals/streams retain state.
- [ ] Bulk close archives agents and closes terminals server-side with the correct confirmation wording.
- [ ] An empty, fully-hydrated workspace auto-seeds a draft composer tab.
- [ ] Non-`ready` route states render the gate shell with retry/manage/dismiss instead of the workspace.
- [ ] Pinned quick-launch targets (terminal + browser by default) open the right tab kind in one tap, and
      can be toggled from the relevant "new" menus.

## TODO(verify)
- [ ] Runtime division of labor between the layout store and the flat tabs store.
- [ ] Exact focus-mode pane rendering in the split container.
- [ ] Scripts-start RPC and service-URL resolution details.
- [ ] `setup` panel behavior beyond its descriptor.
- [ ] Behavior when a pinned `profile` target's saved create-agent-preferences profile no longer exists.
