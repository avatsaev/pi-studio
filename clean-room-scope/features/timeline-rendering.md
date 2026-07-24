# Timeline Rendering (Agent Stream) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [timeline-streaming.md](timeline-streaming.md),
> [tool-permissions.md](tool-permissions.md), [composer-ui.md](composer-ui.md), [rewind.md](rewind.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md),
> [../architecture/design-system.md](../architecture/design-system.md)

> **Render stack:** Pi-Studio implements this UI on a **React 19 + Vite DOM** stack (web + Electron
> only), not React Native. Timeline virtualization uses `@tanstack/react-virtual`; markdown uses
> `react-markdown` + `remark-gfm`. Behavior/contracts below are medium-independent; for concrete
> libraries see [../architecture/design-system.md](../architecture/design-system.md) § UI technology
> stack and [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md) § Platform rules.

## Purpose

Defines how the client **renders** an agent conversation timeline: the catalog of row kinds and the visual
treatment of each (user message, assistant markdown, reasoning, tool-call cards and their expanded
details, diffs, permission prompts, errors, attachments, file links, compaction, todos), plus turn
grouping, inter-row spacing, turn footers, markdown feature support, syntax highlighting, and the
autoscroll / bottom-anchor behavior. The *data* model and sync correctness (live vs. authoritative paged
catch-up) are specified in [timeline-streaming.md](timeline-streaming.md); this document is purely the
presentation layer.

## Public Contract

### The render model
The stream view receives a flat array of render items and dispatches each to a row component. Items are
split into segments for performance: virtualized older history (web, when long), mounted recent history,
and a live head. Streamable kinds (assistant text, reasoning) buffer in a head while streaming and flush
into the committed tail on turn-completion; assistant text is split into markdown **blocks** with stable
ids so streaming only re-renders the last block.

### Row kinds
| Kind | Key fields | Renders as |
|------|-----------|------------|
| `user_message` | `text`, `timestamp`, `images?`, `attachments?`, `optimistic?`, `queued?` (web-client only — set for a steered message, cleared by `queue_update`; see [composer-ui.md § Steering](composer-ui.md)) | Right-aligned bubble |
| `assistant_message` | `text`, `messageId?`, `blockGroupId?`, `blockIndex?` | Markdown block(s) |
| `thought` | `text`, `status: loading\|ready` | Collapsible "Thinking" card (a tool card with a brain icon) |
| `tool_call` | `payload` (agent or orchestrator) | Tool-call card, or a "Spoke" block, or a plan card, or a todo |
| `todo_list` | `provider`, `items: {text,completed}[]` | "Tasks" card |
| `activity_log` | `activityType: system\|info\|success\|error\|artifact`, `message`, `metadata?` | Colored info/error pill row |
| `compaction` | `status: loading\|completed`, `trigger?`, `preTokens?` | Horizontal-rule "Context compacted" marker |

Agent tool-call data: `{ provider, callId, name, status: running\|completed\|failed\|canceled, error,
detail: ToolCallDetail, metadata? }`.

## Behavior & Algorithms

### Row dispatch
Switch on `kind`:
- `user_message` → user bubble (with first/last-in-group flags from layout).
- `assistant_message` → markdown renderer wrapped in a file-link resolver provider, with layout spacing.
- `thought` → tool card with name "thinking", status ready→completed else executing.
- `tool_call`: agent source → if name is "speak" with string input, a "Spoke" block; else a tool-call card;
  orchestrator source → a tool-call card with arguments/result.
- `activity_log` → colored pill row.
- `todo_list` → "Tasks" card.
- `compaction` → compaction marker.
Each row is centered in a max-width column (820) with horizontal padding, gets a bottom margin = the layout
gap, and may have a turn footer prepended/appended. The layout engine owns outer spacing; row components
suppress their own outer margins via a context flag.

### Row treatments
- **User message:** right-aligned bubble (`surface3`, large radius with a notched top-right corner, padding
  16). Inside: image thumbnails (48×48 pills, wrap) → structured attachment pills (review/PR/issue/text,
  max-width ~220) → selectable text. Below (right-aligned), revealed on hover (always on native/compact):
  timestamp, an optional **rewind menu** (see [rewind.md](rewind.md) — hidden entirely when the agent's
  provider supports no rewind mode), copy button. Web-client only: a small "queued" pill next to the
  sender label while `queued` is set (steered message not yet delivered to the LLM).
- **Assistant message / markdown:** vertical padding 12, collapsible top/bottom when adjacent blocks share a
  block group. Text split into memoized markdown blocks (12px between blocks). Markdown engine with
  typographer + linkify; `file://` links allowed. See § Markdown support.
- **Reasoning ("thinking"):** the tool card with a brain icon, label "Thinking", shimmer while not ready;
  streamed text shown as plain text in the expanded body.
- **Tool-call card:** see § Tool-call cards.
- **Activity log pill:** colored by type — system (gray), info (blue), success (green), error (red),
  artifact (blue, clickable); optional "Details ▸" reveals pretty-printed JSON metadata.
- **Compaction marker:** thin line — center label — thin line, scissors icon. Label: loading → spinner +
  "Compacting…"; completed → "Context automatically/manually compacted" or "Context compacted (N tokens)".
- **Todo list:** a "Tasks" card; secondary label = first incomplete task; expanded body lists todos with a
  radio (filled+check when done) and strike-through completed text.
- **Speak:** small "Spoke" block (mic icon) + spoken text.
- **Plan card:** bordered `surface1` card with title + optional description + full markdown body (and an
  optional footer used for plan permission actions).

### Tool-call cards
The core row card. Build a presentation from the detail (or synthesize an "unknown" detail from
args/result): `displayName`, `summary`, `errorText`, icon, and flags (`isLoadingDetails`, `hasDetails`,
`canOpenDetails`, `openFilePath`, `isPlan`). Plan details render a plan card instead of a badge.

- **Status visuals:** running/executing → label shimmer (web: gradient sweep; native: SVG peak overlay) +
  dimmed label; failed → an alert icon replaces the tool icon + an Error section in the expanded body;
  completed/canceled → static icon.
- **Layout:** header row = icon badge + label (`displayName`) + muted single-line secondary label
  (`summary`, e.g. file path / shell command / query). On hover a chevron replaces the icon and, if a file
  is associated, an "open file" affordance appears. Press toggles inline expansion (desktop/web) rendering
  the expanded detail (max height ~400), OR opens a bottom sheet on compact. Tool-sequence rows pack
  tightly (no inter-row gap).

#### Icon mapping (by detail type / name)
shell, worktree_setup → terminal; read → eye; edit, write → pencil; search, fetch → search; sub_agent /
name `task` → bot; plan / name `thinking` → brain; speak → mic; plain_text → its own icon or wrench;
Pi-Studio tools → the Pi-Studio logo; else → wrench.

#### Display name / summary mapping (by detail type)
shell → "Shell" / command; read → "Read" / filePath (cwd-stripped); edit → "Edit" / filePath; write →
"Write" / filePath; search → "Search" / query; fetch → "Fetch" / url; worktree_setup → "Worktree Setup" /
branch; sub_agent → subAgentType or "Task" / description; plain_text → humanized name / label; plan →
"Plan"; unknown+`task` → "Task" / sub-agent activity; unknown+`thinking` → "Thinking"; name `terminal` →
"Terminal"; else → humanized tool name (snake/kebab → Title Case, keeping paths/`::`/`__` verbatim).
`errorText` is set only when status is failed.

#### Expanded tool detail (by detail type)
| type | renders |
|------|---------|
| `shell` | monospace scroll: `$ command` then output (full-bleed `surface1`) |
| `worktree_setup` | monospace log, or "Preparing worktree {branch} at {path}" |
| `sub_agent` | parses `[Tool] summary` lines into action rows, shows `session <id>`, then remaining log |
| `edit` | a diff viewer from a unified diff or computed line diff, syntax-highlighted by file path (full-bleed) |
| `write` | file content in a highlighted scroll section (by extension) (full-bleed) |
| `read` | content highlighted by extension with a line-number gutter starting at `offset ?? 1` |
| `search` | sections: content, file paths, web results (title/url), annotations |
| `fetch` | url then result |
| `plain_text` | text in UI font |
| `unknown` | string input with no output → plain text; else "Input"/"Output" JSON sections |
Plus an **Error** section (destructive border/text) when `errorText` is present. Empty → "No additional
details available" (or a shimmer skeleton while loading). Full-bleed types use `surface1` with no
border/radius; others are bordered `surface2` scroll areas. All code/JSON surfaces are tagged to keep the
monospace font even when a custom UI font is applied. Nested horizontal+vertical scrolling.

### Diff rows
Each diff line is a row with a type-colored background: add (green tint, changed word segments brighter),
remove (red tint), header/context (`surface1`, muted). Lines may carry syntax-highlight tokens and/or
intra-line word-diff segments. A prefix char (`+`/`-`/space), monospace, horizontal scroll preserving
whitespace.

### Permission request prompt
Pending permissions render in a live auxiliary area below the turn footer (not as committed stream rows):
- `question` kind → a question form card.
- `plan` kind with markdown → a plan card (title/description/markdown/footer).
- otherwise → a bordered `surface1` card: title + description + optional plan + the expanded tool detail
  (max height ~200) + an action footer ("How would you like to proceed?" + buttons; defaults Deny / Accept).
  While responding, the button shows a spinner; the response is sent with a timeout. See
  [tool-permissions.md](tool-permissions.md).

### Attachments & images
- User images → 48×48 thumbnail pills (preview URL resolved via the client; placeholder while loading).
- User structured attachments → labelled pills (review · N comments / PR #n / issue #n / text title).
- Assistant inline markdown images resolve workspace/`file://`/data URLs through the daemon client (min
  height ~160, full width, error fallback). A full-screen lightbox exists for image viewing.

### File-link chips / inline path links
Markdown links and inline-code-that-looks-like-a-path become file links. On web they render as an anchor
wrapping a pressable, underline on hover, default navigation prevented (app-handled); Cmd/Ctrl-click opens
in a side pane; a tooltip shows the workspace-relative path + "⌘ click for side pane". On iOS they must be
text spans inside the selectable-text view. Pressing opens a workspace file tab / side pane, or the file
explorer for directories.

### Turn grouping, spacing & footers
- **Turn timing:** a turn starts at a user message and ends before the next user message; per assistant
  message records start/complete/duration. While the agent is running, the in-flight turn is not flushed.
- **Running footer:** a spinner (amber) + a live elapsed timer (ticks ~10×/s).
- **Completed footer:** attaches under the last assistant message of a finished turn; shows a copy button +
  "Worked for <duration>" that swaps to the end timestamp on hover (web) / tap-reveal (native).
- **Block grouping & gaps:** consecutive assistant messages sharing a block group collapse spacing
  (inter-block gap 12). Gap rules: user→user 4; tool-seq→tool-seq 0 (packed); user→tool-seq 16;
  assistant↔tool-seq 4; same assistant block group 12; default 16. When a completed footer attaches to a
  row, that row's bottom gap is forced to 0.
- Footer placement order is strategy-driven (web appends after content; native inverted list prepends).

### Autoscroll / bottom anchoring
- **Native:** an inverted list (bottom = offset 0); the live head + auxiliary render at the visual bottom;
  older-history spinner at the top; near-bottom threshold small (~32px); pulling toward the oldest edge
  loads older history.
- **Web:** a normal-order scroll with partial virtualization when history is long (older items become
  height-estimated placeholders; the most recent ≥50 items are real and the mounted window snaps back to a
  user-message boundary). Near-bottom = distance-from-bottom ≤ threshold.
- A **bottom-anchor controller** is a frame-scheduled state machine with `sticky-bottom` and `detached`
  modes: route requests (initial entry / resume) and local requests (jump-to-bottom / message-sent)
  trigger a scroll-to-bottom attempt with a verification + bounded retry pass; it blocks until authoritative
  history is ready and the viewport/content are measurable; it stays pinned through content growth and
  detaches when the user scrolls away beyond a small delta while nothing is pending. Native adds settling
  frames on keyboard/viewport changes.
- A floating **scroll-to-bottom** button (round chevron-down) fades in when not near bottom.
- Empty state: centered muted "Start chatting with this agent…".
- On web, expanding a tool card disables the parent list scroll and blocks wheel propagation so the nested
  detail captures the wheel.

### Markdown feature support
Headings h1–h6 (h1/h2 bordered + larger; h6 uppercase muted); bold/italic/strikethrough; paragraphs and
hard/soft breaks (preserved as explicit spans so iOS doesn't drop them); inline code (`surface2`, mono;
file-path → inline file link; URL → auto-link); fenced/indented code blocks → highlighted code block;
bullet/ordered lists (custom marker + nested spacing); links → file-link component; images → resolved
image; GFM tables (bordered, header on `surface2`, equal-width cells); blockquote (`surface2` + 4px accent
left border); horizontal rule. Prose line-height ≈ `fontSize.base * 1.4`; web text is user-selectable.

### Syntax highlighting
Applied to markdown code blocks, file previews, tool detail read/write, diffs, and the appearance preview.
A fence info string maps to a file extension (with an alias table: typescript→ts, python→py, rust→rs,
c++→cpp, …); the highlight package returns keyed lines of tokens (cached). Each token is a styled text span;
a token-kind→color map (keyword, comment, string, number, function, type, tag, attribute, property,
variable, operator, punctuation, regexp, escape, meta, heading, link, …) reads `theme.colors.syntax.*`
(unknown → base foreground). The same lookup serves diff tokens. Code surfaces are tagged so a custom UI
font doesn't replace the mono font. Code-block wrappers show a hover-revealed (always on native/compact)
copy button with a brief "Copied" confirmation.

## Data & Persistence
- Render items derive from the timeline store + live stream (see
  [timeline-streaming.md](timeline-streaming.md)); rendering itself is stateless apart from per-render
  height-estimate caches and the set of expanded inline tool-call ids.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Tool call failed | Alert icon + Error section with `errorText` |
| Tool detail still loading | Shimmer skeleton in the expanded body |
| Assistant image fails to resolve | Error-text fallback in place of the image |
| iOS nested plain `<Text>` in a paragraph | Use text spans; otherwise the text is silently dropped |
| Long history (web) | Partial virtualization with user-message-aligned mounted window |
| User scrolls up | Detach from bottom; show scroll-to-bottom button; keep streaming |

## Dependencies
- Pinned library versions: see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack.
- Internal: timeline store + sync, tool-call display mapping, the highlight package, design system, file
  links, permissions, attachments.
- External: a markdown renderer (typographer + linkify), inverted list (native), SVG (native shimmer).

## Acceptance Criteria
- [ ] Each row kind renders per the catalog above; tool cards show correct icon/displayName/summary and
      status visuals (shimmer/error/static).
- [ ] Tool-call details expand inline on desktop/web and as a bottom sheet on compact, with full-bleed vs.
      bordered treatments per detail type.
- [ ] A multi-sequence tool call renders as one item; tool-sequence rows pack tightly.
- [ ] A completed turn shows "Worked for <duration>" (→ end timestamp on hover); a running turn shows a live
      elapsed timer.
- [ ] Permission prompts render in the live area with Deny/Accept (question/plan variants) and respond with
      a spinner + timeout.
- [ ] Code blocks/diffs/file previews are syntax-highlighted and keep the mono font under a custom UI font.
- [ ] The view sticks to the bottom while streaming, detaches on user scroll-up, and offers a
      scroll-to-bottom button; a stale heartbeat never hides rows.

## TODO(verify)
- [ ] Exact assistant-image resolution + caching path.
- [ ] Whether any provider emits live terminal-stream rows directly into the timeline (vs. only shell tool
      output).
- [ ] Attachment lightbox interaction details.
