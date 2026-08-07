# File Link Rendering (Chat Timeline) — Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [inline-image-rendering.md](inline-image-rendering.md),
> [timeline-rendering.md](timeline-rendering.md),
> [workspace-split-panes.md](workspace-split-panes.md), [workspace-ui.md](workspace-ui.md),
> [file-explorer-transfer.md](file-explorer-transfer.md), [agent-sessions.md](agent-sessions.md),
> [agent-providers.md](agent-providers.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md)

> **Render stack:** DOM clients only — web-client today, plus the Electron shell once
> sprint-033-desktop wires it to host the same bundle (the desktop package is still a placeholder).
> Markdown rendering is `react-markdown` + `remark-gfm`. Opening the referenced file reuses the
> existing tab-store "open a path as a tab" dispatch and the existing pane drag-and-drop payload
> defined in [workspace-split-panes.md](workspace-split-panes.md) § Drag sources. Nothing in this
> feature adds an RPC message type, an HTTP route, or a new binary opcode.

> **Sibling feature to [inline-image-rendering.md](inline-image-rendering.md)** — identical shape
> (capability flag → system-prompt instruction → markdown node-override), applied to markdown
> *links* instead of images: instead of fetching bytes, a resolved link dispatches the existing
> open-file action. This doc also **amends** inline-image-rendering.md's click-to-open contract: §
> Click-to-open pane targeting below is a defect fix that applies to both features' click handlers,
> since the underlying gap — no pane id reaches timeline row components — is shared, not new to
> either feature individually.

## Purpose

An agent that mentions a specific file or path in prose today produces dead text: the user must
switch to the file explorer and navigate to it manually, even though the agent already knows the
exact path. This feature makes such a reference actionable through the same contract already
established for images — a client advertises that it renders a piece of markdown syntax specially,
the daemon teaches the agent (via a short spawn-time system-prompt instruction) to use that syntax
deliberately when it wants a reference to be actionable, and the client intercepts the syntax at
render time. Here the syntax is an ordinary markdown link (`[label](path)`, the non-`!` counterpart
of the image syntax) and the action is "open this file as a tab" instead of "fetch and display these
bytes."

Two further contracts are introduced alongside the click behavior itself. First, the opened tab must
land in the **pane the chat message is rendered in**, not whatever pane happens to be globally
focused — a gap that also affects the existing inline-image click-to-open, fixed once here for both.
Second, the rendered element is also a **drag source**: dragging it onto any pane edge opens the file
into a fresh split, reusing the exact drop mechanism already defined for the Files tree and the
chat-session sidebar rather than inventing a fourth one.

## Public Contract

### Capability flag

A new client→daemon capability flag, advertised in the `hello` handshake's `capabilities` map,
independent of and composable with `inline_image_markdown`:


| Flag                 | Direction       | Meaning                                                                                                                                                     |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_link_markdown` | client → daemon | This client renders markdown links (`[label](path)`) whose target is a local filesystem path as an open-file action, rather than a plain navigating anchor. |


Appended to the same client-capability registry `inline_image_markdown` lives in; read through the
same `supports(caps, flag)` helper. Purely additive — a client that omits it behaves exactly as
today, and a client may advertise either flag, both, or neither independently.

Advertised by: web-client (and, once sprint-033-desktop wires it, the Electron desktop shell).
Not advertised by: CLI, MCP.

### Markdown link source classification

A pure function over the raw markdown `href` plus the same asset-base/home-dir inputs
`classifyImageSrc` takes ([inline-image-rendering.md](inline-image-rendering.md) § Markdown image
source classification):

```
classifyFileLinkSrc(href, base, homeDir) ->
  | { kind: "local", path: <absolute> } // intercept: open-file action
  | { kind: "external" }                // pass through to the plain <a> path unchanged
```

Deliberately a **two-way** split, simpler than the image classifier's three-way one:


| `href` shape                                                 | Result                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| empty / whitespace                                           | `external`                                                                                                                                    |
| fragment-only (`#section`, an in-page anchor)                | `external` — MUST NOT be intercepted; agent-authored tables of contents and heading anchors must keep working exactly as plain markdown links |
| non-empty path with a trailing `#fragment` (`README.md#usage`) | the fragment is stripped and the remainder re-enters this table; the file opens, the anchor is ignored (no heading/line targeting — see § Out of Scope) |
| `http:` / `https:` scheme                                    | `external`                                                                                                                                    |
| any other explicit `scheme:` (`mailto:`, `tel:`, `file:`, …) | `external`                                                                                                                                    |
| starts with `/`                                              | `local`, path used as-is                                                                                                                      |
| starts with `~`                                              | `local`, `~` expanded against the resolved home dir; `external` if the home dir is not yet known                                              |
| starts with `./` or `../`, or is a bare relative path        | `local`, joined onto `base`; `external` when `base` is absent                                                                                 |


Unlike `classifyImageSrc`, there is no third "unresolvable → fallback text" state and no
extension/viewer-kind gate: any local path qualifies regardless of file type (including a directory —
see § Known Limitations), and anything that does not resolve to a local candidate renders as an
**ordinary, unmodified anchor** rather than fallback text, since a non-file `href` may be a genuinely
working link and must not be visually degraded.

The scheme/tilde/relative resolution rules are otherwise identical to `classifyImageSrc`'s, with two
additions that are contractual here, not cosmetic:

- **Percent-decoding.** The raw markdown `href` arrives percent-encoded for characters like spaces
(`my%20notes.md`); a candidate classified `local` is percent-decoded before resolution. External
hrefs pass through byte-for-byte untouched.
- **Normalization.** A `local` result MUST be a lexically normalized absolute path — `.` and `..`
segments collapsed — never a raw join. A tab's identity is `file:<absolute path>`, matched by exact
string ([workspace-split-panes.md](workspace-split-panes.md) § Tab identity), so an unnormalized
`/repo/./notes.md` from `[notes](./notes.md)` would never match the `file:/repo/notes.md` tab a
Files-tree open minted — silently defeating every tab-reuse acceptance criterion below. The shared
resolver does **not** normalize today (`classifyImageSrc` returns `/repo/./shot.png` for
`./shot.png` against `/repo`).

An implementer SHOULD factor the shared "resolve a scheme/tilde/relative candidate against a base
and a home dir" step into one function reused by both classifiers rather than duplicating it — the
same DRY concern inline-image-rendering.md raises for relative-path joining — and that shared step
is where normalization is added, so both classifiers gain it together.

### Click-to-open pane targeting (amends inline-image-rendering.md)

**The defect.** Today, the "open a path as a tab" dispatch that both this feature and inline-image
click-to-open call accepts an optional target-pane argument; omitted, it defaults to whichever pane
is **globally focused** — not the pane that rendered the click. Nothing in the render tree between
the pane host and a markdown node-override currently carries a pane id at all, so every existing
click-to-open call omits it. A user viewing chat in one pane who last interacted with a different
pane (a terminal, another file tab) gets the opened file in the *wrong* pane.

**The contract.** Every markdown-rendering surface inside a tab's panel content MUST know which pane
owns that tab, and MUST pass that pane id explicitly — never omitted — as the target when it
dispatches an open-file action.


| Surface                                                                             | Owning pane id source                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A tab's panel content (chat, and by extension every row/markdown surface within it) | The pane the panel host already resolves the tab into, via the tab→pane placement map [workspace-split-panes.md](workspace-split-panes.md) § Persisted layout record already maintains |
| Assistant / reasoning row markdown                                                  | Received from its panel ancestor; never re-derived independently                                                                                                                       |
| Open-file dispatch (this feature's link click, and the existing inline-image click) | Always passes the owning pane id as an explicit target; never relies on the "focused pane" default                                                                                     |


The "focused pane" default is not removed — it remains correct for dispatches that have no natural
owning pane (the Files tree sidebar, the chat-session sidebar, both of which sit outside any pane).
It is specifically wrong for a dispatch that originates *from inside* a pane's own rendered content,
which both this feature and the pre-existing image feature are.

Two implementation notes ride along with this fix. First, the pre-existing inline-image click
handler does not actually call the shared open-file dispatch today — it hand-rolls a tab-store open
(always kind `file`, `workspaceCwd: assetBase || "~"`). Applying this contract is the moment to
converge it onto the same dispatch this feature's link click uses; two parallel open paths is
exactly the drift this amendment exists to remove. Second, the dispatch's workspace argument is the
**owning chat tab's workspace cwd** — threaded from the panel host exactly as the owning pane id is
(§ Pane-owner propagation) — never the `assetBase || "~"` approximation.

### Drag-to-split

The rendered element (a local file link, and — by the same fix — a resolved inline image) is a drag
source carrying the identical payload [workspace-split-panes.md](workspace-split-panes.md) § Drag
sources already defines for a Files-tree row: the target's absolute path, under that table's `path`
payload kind. No new payload kind, no new drop region, no new drop-resolution logic — the existing
generic pane-drop handling is the single decision point regardless of which UI element started the
drag, exactly as that doc's § Drag sources table already generalizes across the Files tree and the
session sidebar.

[workspace-split-panes.md](workspace-split-panes.md) § Drag sources gains a fourth row:


| Source                                        | Dropped payload | Already open?                              |
| --------------------------------------------- | --------------- | ------------------------------------------ |
| a file link or inline image in a chat message | that path       | maybe — reuse its tab if so, else open one |


An external (non-local) link or a remote image is never a drag source for this payload — dragging one
falls back to the browser's own default link/image drag behavior, untouched.

## Behavior & Algorithms

### Render pipeline

```
finalized assistant markdown block
  -> markdown renderer, with an `a` node override registered alongside the existing `img`/`code`
     overrides
  -> classifyFileLinkSrc(href, assetBase, homeDir)
       external    -> default <a>, unmodified: normal navigation, normal drag behavior
       local(path) -> actionable element:
            on click:   prevent default navigation; open-file dispatch, target = owning pane id
            drag start: write the pane-drop "path" payload for `path`
```

The `a` override is registered in the same node-override map that already carries the `img` and
`code` overrides — one added entry, no restructuring of the markdown component.

### Agent instruction

When the creating connection advertises `file_link_markdown`, the daemon appends a short instruction
block to that session's system prompt, independently of whether `inline_image_markdown` is also
advertised. Content requirements (exact wording is not contractual, these properties are):

- States that referencing a specific file or path can be made actionable.
- Instructs the agent to format such a reference as a markdown link: `[label](path)`.
- States that `path` follows the same rules as image paths — workspace-relative, absolute, or
`~`-relative.
- Constrains it to files that actually exist on the machine.
- Short — a handful of lines, same order of magnitude as the image instruction.

### Composing multiple capability-gated instructions

Because a client can now advertise zero, one, or both of `inline_image_markdown` and
`file_link_markdown` independently, the composition point that appends instruction blocks to a
session's system prompt MUST generalize beyond a single flag:

```
function composeSystemPrompt(callerPrompt, advertisedCapabilities):
    blocks = []
    for (flag, instructionText) in CAPABILITY_INSTRUCTIONS:   # ordered, stable list
        if advertisedCapabilities.supports(flag):
            blocks.append(instructionText)
    if blocks is empty:
        return callerPrompt                                    # unchanged, absent stays absent
    return join([callerPrompt, *blocks], separator = blank line)
```

`CAPABILITY_INSTRUCTIONS` is an ordered list (image instruction, then file-link instruction, in this
scope), so which blocks are present and in what order is deterministic regardless of which subset of
capabilities a given client advertised — never an accidental artifact of how many `if` branches were
bolted onto a single-capability check. A caller-supplied prompt always comes first and is never
reordered or replaced; the mechanics (append-only, persisted in the agent record's config, provider
ignores the field if unsupported) are otherwise identical to
[inline-image-rendering.md](inline-image-rendering.md) § Agent instruction → Mechanics.

### Pane-owner propagation

```
panel host, for each open tab:
    pane = the tab's owning pane, from the already-computed tab->pane placement
    render the tab's panel component with (tab, owningPaneId = pane)

chat panel:
    render its timeline with (session, owningPaneId)

timeline:
    render each row with (row, assetBase, owningPaneId)

assistant / reasoning row:
    render its markdown with (text, assetBase, owningPaneId)

markdown:
    the `a` override (this feature) and the `img` override (inline-image-rendering.md) both
    receive owningPaneId and pass it as the explicit, never-omitted target on their open-file
    dispatch
```

A tab that is not yet placed in any pane (a brand-new tab mid-creation) has no owning pane id yet;
the open-file dispatch's pre-existing "no target given" fallback (the globally focused pane) covers
that transient case — it never throws or blocks the click.

## Data & Persistence

- **Client:** no new persisted state. The owning pane id is derived at render time from the layout
state [workspace-split-panes.md](workspace-split-panes.md) already persists; it is never stored
per-row or per-message.
- **Daemon:** the composed system prompt (caller-supplied text plus zero, one, or two capability
instruction blocks) is stored in the agent record's config exactly as any system prompt already is.
No new persisted entity, no schema migration.
- **Wire:** no new message type, no new binary opcode, no changed field semantics. One added
capability flag string.

## Error Handling & Edge Cases


| Condition                                                               | Expected behavior                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Link resolves to a local path but the file no longer exists             | The tab opens; the file viewer's own missing/unreadable state renders — the same outcome as opening a stale Files-tree entry. No separate error state lives in the link itself                                                                                                                                                       |
| `href` is `#section` (in-page anchor)                                   | Renders as an ordinary anchor; never intercepted, even with a valid asset base                                                                                                                                                                                                                                                       |
| `href` is `notes.md#usage` (path + trailing fragment)                   | The fragment is stripped; `notes.md` classifies as any other candidate. The file opens, the anchor is ignored                                                                                                                                                                                                                        |
| `href` is `mailto:`/`tel:`/another non-http scheme                      | Renders as an ordinary anchor; never intercepted                                                                                                                                                                                                                                                                                     |
| `href` resolves to a directory                                          | Falls through to the open-file dispatch as any other local path would; the viewer surfaces whatever its own "not a file" state is. See § Known Limitations                                                                                                                                                                           |
| Relative `href` with no asset base                                      | Renders as an ordinary anchor; not intercepted, no path guessed                                                                                                                                                                                                                                                                      |
| `~`-prefixed `href` before the home directory has resolved              | Renders as an ordinary anchor; re-renders as actionable once the home dir arrives, same mechanism as the image feature                                                                                                                                                                                                               |
| Dragging a local link/image onto a pane edge                            | Identical split outcome to dragging the same path from the Files tree, including existing-tab reuse                                                                                                                                                                                                                                  |
| Dragging an external link or remote image                               | Not a recognized pane-drop payload; the browser's own default link/image drag behavior applies, unchanged                                                                                                                                                                                                                            |
| Client does not advertise `file_link_markdown`                          | No instruction is appended to new sessions; the render override remains active regardless — the capability gates the *instruction*, never the *rendering*, exactly as `inline_image_markdown` does. A pre-existing `[label](path)` already in history (e.g. hand-typed by a user, or from an older session) still renders actionable |
| Client advertises both `inline_image_markdown` and `file_link_markdown` | Both instruction blocks are appended, in the stable order § Composing multiple capability-gated instructions defines; neither omits nor reorders the other                                                                                                                                                                           |
| A tab not yet placed in any pane dispatches an open-file action         | Falls back to the pre-existing globally-focused-pane default; never blocks or throws                                                                                                                                                                                                                                                 |


## Known Limitations (accepted)

**Directories are not specially handled.** A link/image resolving to a directory dispatches the same
open-file action as a file, and the viewer shows whatever its own non-file state already is. This
knowingly relaxes a source-side rule [workspace-split-panes.md](workspace-split-panes.md) § Drag
sources imposes on the Files tree — a directory row must never advertise itself as pane-droppable,
because a drop target cannot inspect a payload mid-drag. With no existence or type pre-check
(below), a link cannot know it targets a directory, so a directory-target link *is* draggable here,
and a drop fills the new split with the viewer's non-file state. Accepted: the outcome is benign,
and the alternative is exactly the pre-check this scope omits. A "reveal in the Files tree" action
for a directory target is a reasonable follow-on, not built here.

**Spawn-time instruction binding.** Identical accepted asymmetry to
[inline-image-rendering.md](inline-image-rendering.md) § Known Limitations: the instruction is fixed
at agent spawn time, so a session created by a client that did not advertise the capability never
retroactively gains it, and vice versa. Not re-derived here — refer to that doc's clause, which now
applies to both capability flags identically.

**No existence pre-check before click or drag.** Unlike an inline image (which must fetch bytes and
therefore already knows whether the file resolved), a link's staleness is discovered only once the
tab opens — surfacing exactly like a stale Files-tree entry would, never as a distinct "broken link"
state.

**Bare-word or code-span file mentions are never auto-linked.** Requiring the agent to use markdown
link syntax deliberately is the whole contract, mirroring why image syntax is required rather than
inferred from image-looking words in prose — see § Out of Scope.

## Dependencies

- **Internal (client):** the shared markdown renderer's node-override map (adds an `a` override
beside the existing `img`/`code` overrides); the tab-store "open a path as a tab" dispatch — the
same primitive the Files tree, its context menu, and the sidebar-to-pane drag already call; the
pane-drop payload registry [workspace-split-panes.md](workspace-split-panes.md) § Drag sources
extends with a new source, introducing no new payload kind; the persisted tab→pane placement map,
now also read to derive the owning-pane-id fix.
- **Internal (daemon/protocol):** the client-capability registry and its `supports` helper (already
extended for `inline_image_markdown`); the per-connection session state already threaded onto the
agent-creation RPC handler for that feature, reused verbatim; the system-prompt composition point,
generalized from a single-capability check to the ordered, N-capability form § Composing multiple
capability-gated instructions defines — a change inline-image-rendering.md's implementation must
also pick up, since both flags now share it.
- **External:** none added.

## Acceptance Criteria

- [ ] `[label](./notes.md)` in an assistant message with a resolvable asset base renders as an
  actionable element, not a plain navigating anchor.
- [ ] The same with an absolute path and with a `~`-prefixed path renders actionable.
- [ ] `[docs](https://example.com)` renders as an ordinary external link; no interception.
- [ ] `[jump](#section)` renders as an ordinary in-page anchor; never intercepted, even with a valid
  asset base.
- [ ] A relative link with no asset base renders as an ordinary anchor, not intercepted.
- [ ] Clicking an actionable link reuses an already-open tab for the same path rather than opening a
  duplicate — including when the link was written `./`-relative and the existing tab was opened
  from the Files tree (normalization).
- [ ] Clicking an actionable link opens the file into the pane the clicked message is rendered in and
  focuses that pane — never into a different pane that merely happens to be globally focused.
- [ ] The same pane-targeting behavior is verified for the pre-existing inline-image click-to-open
  (regression coverage for the fix, not just the new feature).
- [ ] Dragging an actionable link onto a pane's edge splits that pane and opens the file into the new
  split, identical to dragging the same path from the Files tree.
- [ ] Dragging an actionable link onto a pane's center region opens/moves into that pane without
  splitting.
- [ ] Dragging an actionable link that already has an open tab elsewhere reuses that tab, following
  the same no-duplicate rule a Files-tree drag already follows.
- [ ] A web-client-created agent session's persisted config contains the file-link instruction
  appended after any caller-supplied prompt; a CLI-created session's does not.
- [ ] A session created by a connection advertising both capabilities has both instruction blocks
  appended, in a stable, deterministic order.
- [ ] `classifyFileLinkSrc` is unit-tested across every row of its classification table, including
  the fragment-only, path-plus-fragment, unknown-scheme, no-asset-base, percent-encoded, and
  `.`/`..`-normalization cases.
- [ ] No new wire message type, binary opcode, or HTTP route was introduced.

## Out of Scope

- Auto-linking bare or code-span file mentions that are not already wrapped in markdown link syntax
— structured syntax is the contract, exactly as with image syntax.
- Directory-specific handling (open-as-tab vs. reveal-in-explorer) beyond falling through to the
existing open-file dispatch.
- Line-number-targeted opening (`path:42`) and heading-anchor targeting — a trailing `#fragment` is
stripped and ignored, never resolved to a heading position.
- Non-DOM clients (a future client opts in the same way images do: advertise the flag, implement the
render half against its own primitives).
- A modifier-click "open beside" affordance distinct from drag-to-split — drag onto a pane edge is
the only side-by-side path this scope adds.
- Live refresh of the classification if the asset base or home directory changes after a message has
already rendered.

## TODO(verify)

- [ ] The capability-flag string (`file_link_markdown` throughout this doc) is a proposed name, not

  yet confirmed against a shipped implementation — the task that adds it to the protocol package
  settles this.

