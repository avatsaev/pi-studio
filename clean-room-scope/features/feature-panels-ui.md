# Feature Panels UI — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [workspace-ui.md](workspace-ui.md),
> [file-explorer-transfer.md](file-explorer-transfer.md), [git-checkout.md](git-checkout.md),
> [terminals.md](terminals.md), [subagents.md](subagents.md),
> [../features/desktop-app.md](desktop-app.md)

## Purpose

Defines the **client-side UI** of the workspace feature panels: the file explorer + file preview, the
git changes / diff / PR panel and inline code review, the terminal pane, the embedded browser pane, and the
subagents track. The daemon-side behavior for these features is specified in their sibling docs
([file-explorer-transfer.md](file-explorer-transfer.md), [git-checkout.md](git-checkout.md),
[terminals.md](terminals.md), [subagents.md](subagents.md)); this document is the presentation + interaction
layer.

## Public Contract

### How panels plug in
Workspace content is tiled panes; a panel registry maps a tab `kind` → component + descriptor (see
[workspace-ui.md](workspace-ui.md)). Tiled panel kinds: `terminal`, `browser`, `file`, plus agent/draft/
setup. The **file explorer + git changes + PR** views are NOT tiled panels — they live in a separate
**explorer sidebar** (tabbed: Files / Changes / and PR when one exists), pinned on wide and an overlay on
compact. Each panel reads the pane context + pane focus and renders a "directory not found" state when the
workspace execution directory is unavailable. Clicking inside a pane focuses it unless the click hit an
interactive element.

## Behavior & Algorithms

### File explorer
A lazily-loaded, single-column indented **tree**. Selecting a file opens a separate **file preview pane**
(a tiled tab), not inline.
- **Header** (height 36): a sort-cycle button (Name → Modified → Size) + a refresh icon. Directories always
  sort before files; Modified = newest first, Size = largest first.
- **Tree rows:** `{ entry, depth }`, indentation per depth with vertical indent guides. Directory rows show
  a chevron (rotates when expanded) or a spinner while listing; file rows show a Material file icon. Name is
  ellipsized. A kebab menu shows metadata (size, modified-ago) + actions: Copy path (absolute), Download
  (files only).
- **Lazy expansion:** expanded paths persist per workspace (default = root). Expanding lists the directory in
  the background; on init, list root then re-request persisted expanded paths so the tree restores. Tree
  flattening is a DFS from root, recursing into expanded directories.
- **Refresh:** re-list root + all expanded paths in parallel (spinner while fetching).
- **Download:** files only — request a download token from the daemon, then start a download via the
  download store (see [file-explorer-transfer.md](file-explorer-transfer.md)).
- **States:** no workspace scope → "Workspace is unavailable"; initial load → spinner + "Loading files…";
  error → red text + Retry (+ Back if a file was selected); empty → "No files".

#### File preview pane
Opening a file mounts a `file` tab (label = filename, subtitle = path, file icon). Resolve the read target
(handles `~`-relative, workspace-relative, absolute-within-root, absolute-outside-root → derived fs root),
read via the daemon, and render by result kind:
- **markdown** (`.md`/`.markdown`, when not a line deep-link) → markdown with code highlighting + external
  links.
- **text/code** → syntax-highlighted line-by-line with a line-number gutter, selectable; mobile = vertical
  scroll only, desktop = nested horizontal scroll for long lines; a `lineStart`/`lineEnd` deep-link
  highlights + auto-scrolls to those lines.
- **image** → contained image in a centered scroll (spinner until the preview URL resolves).
- **binary** → "Binary preview unavailable" + file size.
Error → red text; loading → spinner + "Loading file…".

### Git: changes / diff / PR
Appears as the explorer sidebar **Changes** tab (mobile shows the branch/actions header; the desktop sidebar
hides it). Structure (top→bottom):
1. **Header** (optional): branch icon + branch label + a git-actions split button (primary action + a menu
   of the rest).
2. **Diff status bar** (height 36): diff-mode dropdown (Uncommitted vs Committed, the committed item
   describing `branch → base` when they differ); layout toggle Unified vs Side-by-side (desktop web only);
   whitespace toggle; files toolbar (wrap-lines, expand/collapse-all) when files > 0; refresh (only when the
   daemon advertises the checkout-refresh feature).
3. **PR error text** (when GitHub features on and PR status errored).
4. **Diff body:** a virtualized list of file headers + bodies.

- **Auto diff mode:** uncommitted when dirty, else committed-vs-base; an explicit override is cleared when
  auto mode changes (e.g. after a commit). Diff query returns parsed files (`path`, additions, deletions,
  isNew/isDeleted, status `ok|binary|too_large`, hunks).
- **File header:** tap toggles expand/collapse; shows basename + dir, New/Deleted badges, a diff-stat,
  tooltip full path. Expanded headers are sticky. Heights are measured + cached for stable scrolling;
  collapsing anchors scroll to the clicked header. Expanded paths persist per workspace.
- **Body:** `binary` → "Binary file"; `too_large` → "Diff too large to display". Unified = gutter (colored
  line numbers) + horizontally-scrollable code column, tokenized + syntax-highlighted, wrap toggle. Split
  (desktop web) = two columns with a divider; header rows span full width. Line types add/remove/context/
  header drive colors.
- **Empty messages:** whitespace-hidden → "No visible changes after hiding whitespace"; uncommitted → "No
  uncommitted changes"; base → "No changes vs <base>"; loading → "Checking repository…"; not git → "Not a
  git repository".
- **Git actions** (see [git-checkout.md](git-checkout.md) for daemon semantics): a built set
  `{ primary, secondary, menu }` of actions `{ id, label, pendingLabel, successLabel, disabled, status,
  unavailableMessage, icon, handler }`. Action ids include commit, pull, push, pull-and-push, pr,
  merge-pr-{squash|merge|rebase}, enable/disable PR auto-merge, merge-branch, merge-from-base,
  archive-worktree. Primary precedence: archive (promoted, Pi-Studio worktree) → commit (dirty) → pull
  (behind, clean) → direct PR merge → enable PR auto-merge → "pr" → push → merge-branch → merge-from-base →
  view PR. Each unavailable action carries a human-readable reason. Per-action run-state (idle/pending/
  success) drives disabled + spinner.
- **PR pane** (Changes sidebar's PR tab when a PR exists): a header (PR number/title, state icon/label
  open/draft/closed/merged, open-in-browser) over a scrollable **activity timeline** merging, in
  chronological order: review comments (inline + top-level), review-state changes (approved / changes
  requested / commented), and CI check runs (success/failure/pending, grouped per check with a
  status icon). Each activity/thread entry shows its location (file + line for inline comments, or a
  general PR-level location label) and author/timestamp. A loading skeleton and an error state (with
  retry) cover the fetch.
  - **Attach to chat:** a comment, review (when it carries a body or is `changes_requested`), or a
    **failed** check's logs can be attached to the composer as a workspace attachment so the agent can
    act on the reviewer's feedback or the CI failure directly (`canAddPullRequestActivityToChat` /
    `canAddPullRequestCheckLogsToChat` gate which rows offer the affordance). The attachment carries
    the PR number/title/url, the activity's location, and its body/log text.
  - **Tab presentation:** the explorer sidebar's PR tab icon reflects overall PR/check state; its label
    is the PR number (e.g. `#42`).

#### Inline code review (inside the diff)
Draft review comments anchored to diff lines, stored locally (persisted), surfaced as inline threads:
- Model: `{ id, filePath, side: old|new, lineNumber, body, createdAt, updatedAt }`, keyed by a scope that
  includes the active diff mode (so switching Uncommitted/Committed is remembered). Comments become a
  workspace attachment so the composer can send them to the agent.
- UI: a gutter `+` affordance appears on hover (web) / tap (native) over reviewable lines; lines with
  comments get a highlighted gutter. Inline threads render as reserved-height rows beneath the line (body +
  edit/delete). The editor is a multiline input (Cancel = Esc, Comment = mod+Enter), auto-focused, with
  focus coordinated with the pane focus-restoration. Thread heights are precomputed so the virtualized list
  reserves space (split layout uses the max of the two sides).

### Terminal pane
A tiled `terminal` panel (label = terminal title, terminal icon); requires the execution directory;
renders an empty filler when its workspace is not focused.
- **Rendering:** an xterm instance inside a DOM component / webview; theme from the terminal color tokens,
  user mono font, code font size, configured scrollback. The emulator exposes write/restore/render-snapshot/
  clear/blur + focus/resize tokens.
- **Streaming:** subscribe to one terminal at a time (unsubscribe the previous), route output/snapshot/
  restore for the active id only, resend a preferred size right after subscribe. Status `{ isAttaching,
  error }` drives an attach spinner overlay + an error row; exit sets "Terminal exited".
- **Reconnect/restore:** when the daemon advertises terminal-restore modes, subscribe with a visible-snapshot
  restore (bounded scrollback). Snapshots cache per workspace scope (`serverId:cwd`) in an in-memory map,
  replayed when the renderer is ready, cleared on restore/exit; sessions are ref-counted so they survive
  pane remounts. On focus/visibility change, re-request reflow and force a fresh resize.
- **Input/keys:** output written only when the workspace is focused and the active id matches. Input goes
  through a bounded pending queue flushed once attached + error-free (raw data or structured keys honoring
  kitty/win32 input modes). Resize: only the claiming, focused, visible pane sends resize (deduping
  identical sizes).
- **Mobile virtual keyboard:** a two-row key bar (Esc, Tab, Ctrl, ↑, Shift, ⌫/Alt, Space, ←, ↓, →, Enter)
  with sticky modifier toggles applied to the next key. Keyboard show/hide pulses several reflows and shifts
  padding. Swipe (mobile, viewing agent): right → agent list, left → file explorer (blurs the terminal
  first).
- **Local file links:** an xterm link provider detects file-path tokens, resolves them, and opens them in the
  workspace.
- **States:** host not connected → message; attaching → spinner; stream error → red row.

### Browser pane (embedded)
- **Platform split:** native and plain web → a "Browser is desktop-only" placeholder; **Electron** → a real
  embedded browser via a `<webview>`. A tiled `browser` panel (label = page title or hostname, subtitle =
  URL, icon = favicon or globe, running status while loading); state keyed by browser id `{ url, title,
  faviconUrl, isLoading, canGoBack, canGoForward, lastError }`.
- **Chrome row** (height 36): Back / Forward (disabled per state), Refresh (Stop while loading), a URL input
  (submit navigates), and — dev only — Open DevTools + element-selector toggle. An error row shows the last
  error.
- **Webview lifecycle:** created with a per-browser persistent partition, popups allowed, autosize; events
  sync the store (loading, navigation/url, title, favicon, fail-load [ignoring aborted/sub-frame], dom-ready,
  focus). URLs normalized; only http(s)/about:blank allowed (others set a last-error and skip). Aborted/
  blocked errors swallowed.
- **Shortcuts (interactive pane):** mod+L focus/select URL; mod+R refresh; responds to a desktop focus-url
  event.
- **New-tab requests** (Electron): validated http(s)/about:blank requests from the page spawn a new browser
  tab.
- **Element selector** (dev): injects JS that highlights hovered elements and, on click, captures element
  metadata (tag, text, selector, attributes, computed styles, bounding rect, source, parent chain, children),
  formats it, and adds it as a `browser_element` workspace attachment for the agent. Esc cancels; auto-cancel
  after 30s.

### Subagents track
A collapsible strip listing the **child agents** of the currently-open agent, mounted directly above the
composer. (Membership/policy semantics are in [subagents.md](subagents.md); this is the UI.)
- **Membership:** agents whose parent is the open agent, not archived / not pending-archive, sorted by
  creation ascending. Renders nothing when empty.
- **Layout:** a rounded surface merging into the composer top; a header (chevron + summary label, collapsed
  by default) toggling an expanded scroll list (max height ~200). Header label: "N subagent(s)" + " · K
  running" when any run.
- **Row:** provider icon + label + archive button. A missing/placeholder title → "Loading…" (loading title
  state); status drives the status bucket. Tap opens the subagent. The archive button is hover-revealed on
  web and always visible on native/compact (tracked on the wrapping view so moving to the button doesn't
  drop hover); tooltip "Archive subagent" (desktop).
- **Archive flow:** a confirm dialog ("Archive running subagent?" warning it will stop, or "Archive
  subagent?"), destructive confirm "Archive", then archive on the daemon (global; propagates to all clients).

## Data & Persistence
- Per workspace (client-local): explorer expanded paths + sort option, diff expanded paths + active mode,
  review draft comments. Terminal snapshots cache in memory per scope. Browser state per browser id. See
  [persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Workspace dir unavailable | Panel shows "directory not found" |
| File read error | Red error text + recovery (Retry/Back) |
| Diff binary / too large | "Binary file" / "Diff too large to display" |
| Terminal not focused | Empty filler; no output written; no resize sent |
| Terminal reconnect | Restore from cached snapshot; re-request reflow |
| Browser on native/plain web | Desktop-only placeholder |
| Unsafe browser URL scheme | Set last-error; skip navigation |
| Subagent archive while running | Confirm warns it will stop the subagent |

## Dependencies
- Pinned library versions: see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack.
- Internal: panel registry + pane context, daemon client (list/read/download/subscribe), git checkout +
  GitHub services, terminal stream protocol + restore, the highlight package, workspace attachments,
  subagents policy, design system.
- External: xterm (terminal), Electron webview (browser), Material file icons, a markdown renderer.

## Acceptance Criteria
- [ ] The file explorer lazily lists directories, persists expansion per workspace, sorts (name/modified/
      size, dirs first), and opens files into a preview pane (text/code/markdown/image/binary).
- [ ] The diff panel shows uncommitted vs committed, unified vs split (desktop web), whitespace toggle, and
      virtualized sticky file headers; empty/loading/not-git messages are correct.
- [ ] Git actions surface the right primary action with reasons for unavailable ones and per-action pending/
      success state.
- [ ] Inline review comments anchor to lines, persist, and feed the composer as an attachment.
- [ ] The terminal attaches/streams/reconnects with snapshot restore, sends resize only from the claiming
      focused pane, and shows the mobile key bar on compact.
- [ ] The embedded browser works on Electron (nav/url/favicon/error/new-tab/element-selector) and is a
      placeholder elsewhere.
- [ ] The subagents track lists children, opens them, and archives them (confirm) with the archive button
      hover-gated on web and always shown on touch.
- [ ] The PR pane's activity timeline merges comments/reviews/checks chronologically, and a failed check's
      logs or a review comment can be attached to the composer as context for the agent.

## TODO(verify)
- [ ] Byte-transfer/save path for file downloads (download store internals).
- [ ] Terminal snapshot serialization format.
- [ ] Full PR activity/check data shape and the exact daemon RPC for fetching a failed check's logs.
- [ ] Explorer-sidebar open/pin/overlay mechanics (mobile overlay vs desktop pinned).
