# Feature (UI) — Drop a Files-tree row into the composer as a relative path

> **Status: shipped** in `sprint-081-composer-path-drop` (see `sprints/PLAN.md`). Verified live in
> Chromium only; Firefox and Safari were not available to the implementer (§ Acceptance criteria,
> § TODO(verify)).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [workspace-split-panes.md](workspace-split-panes.md) (sidebar-to-pane drag
> transport, § Drop regions / § Drag sources), [file-explorer-move.md](file-explorer-move.md) (Files
> tree row drag: row-to-row move payload), [composer-ui.md](composer-ui.md) (composer regions),
> [ui-components.md](ui-components.md), [../architecture/design-system.md](../architecture/design-system.md)
> Source brief: [../grills/drag-file-into-composer.md](../grills/drag-file-into-composer.md)
> (`Status: grilled`). `Dnn` cites its decisions; they are requirements here, not open choices.

## Purpose

A user writing a prompt often needs to point the agent at a file or folder in the workspace. Today
they type or paste the path by hand, and dragging a Files-tree row onto the composer *opens* the file
in a tab (it is a pane drop). This feature makes a Files-tree row dropped anywhere on the composer
card insert that row's **workspace-relative path** into the draft at the textarea's caret (D1–D4).

Scope: web client only. There is no daemon, protocol, persistence or capability-flag change (D15).

### Non-goals
- Drag sources other than the Files tree: the Changes tab and chat-timeline file links/inline images
  are deferred (D2).
- Rich/chip rendering of the path. The composer stays a plain `<textarea>` over its highlight mirror
  (D1; `packages/web-client/AGENTS.md` forbids swapping it for a rich editor).
- Inserting file contents, or attaching the file.
- Multi-row drags. The tree has one selection and one draggable row per gesture.
- OS-file / image drops onto the composer. Image attachment stays on `+` and paste.
- A keyboard or menu "Insert into composer" action. The tree's existing *Copy Relative Path*
  followed by paste is the v1 non-drag route (D14).

## Public contract

All names below are client-internal (web-client). None is a wire contract.

### 1. Composer-only path-ref drag (own MIME, not an `ExternalDragKind`)

`features/workspace/external-drag.ts` carries a third payload next to the `chat` and `path`
external-drag kinds (D5), but it is **not** a member of `ExternalDragKind`:

| Payload | MIME | Value | Set by | Read by |
|---------|------|-------|--------|---------|
| `chat` kind (`EXTERNAL_DRAG_MIME.chat`) | `application/x-pi-studio-open-chat` *(existing)* | session id | session list rows | pane drop host |
| `path` kind (`EXTERNAL_DRAG_MIME.path`) | `application/x-pi-studio-open-path` *(existing)* | absolute file path | Files tree **file** rows, timeline `FileLink`/`InlineImage` | pane drop host |
| path-ref (`PATH_REF_MIME`) | `application/x-pi-studio-path-ref` | absolute path of the row; **directories carry a trailing `/`** | Files tree rows, **files and folders** | composer only |

Exports: `PATH_REF_MIME`, `hasPathRef(types)`, `encodePathRef(absPath, isDirectory)` (a folder gets
exactly one trailing `/`), `readPathRef(types, read)` (trimmed; `null` when absent or blank), plus the
composer zone marker `composerDropProps()` / `isInComposerDrop(target)` and the pure
`yieldsToComposer(types, targetInsideComposer)` (§ 4).

Rules:
- The path-ref is **never** a pane action. Its presence only makes the composer claim the drag (see
  § Precedence).
- It is deliberately kept **out of** `ExternalDragKind` / `KINDS` / `readExternalDrag`, which stay the
  pane-host vocabulary. Adding it to the kind discrimination would make `externalDragKind` return a
  kind for a folder transfer (`MOVE_MIME` + path-ref only), and a pane host gating on
  `externalDragKind(...) !== null` would start previewing a split for a folder, which has no tab.
- The directory flag is carried in the value as a trailing `/`. One MIME and one string stay
  readable through `getData`, and the `types` list stays the only mid-drag signal. See
  TODO(verify) #1.
- A file row's transfer carries `MOVE_MIME` + `path` + path-ref, and a pane still sees it as `path`;
  a folder row's carries `MOVE_MIME` + path-ref, and a pane sees nothing.
- Shorthand: in the rest of this spec, "`ref`" and "carries `ref`" mean the path-ref payload above. The
  composer card's marker attribute is `data-composer-drop`.

### 2. Files tree drag start (`FileExplorer.handleDragStartRow`)

For every draggable row (the root row stays non-draggable):

| Payload | Files | Folders |
|---------|-------|---------|
| `MOVE_MIME` (row move) | unchanged | unchanged |
| `EXTERNAL_DRAG_MIME.path` (pane open) | unchanged | still **absent** (no directory tab; [workspace-split-panes.md](workspace-split-panes.md) § Drag sources) |
| `PATH_REF_MIME` *(new)* | `absPath` | `absPath + "/"` |
| `effectAllowed` | `copyMove` (unchanged) | **`copyMove`** (was `move`) |

Folders must widen `effectAllowed` to `copyMove`. The composer accepts with `dropEffect = "copy"`,
and a `dropEffect` outside `effectAllowed` is a rejected drop. Row-to-row moves keep setting
`dropEffect = "move"`, which `copyMove` still allows.

### 3. Composer drop zone

The composer's outer card (`Composer.tsx`'s `.card`: textarea, attachment strip and toolbar) is one
drop zone (D4). It is marked so the pane host can recognise it (an attribute marker, the same
technique as `paneDropProps`/`data-pane-drop`; exact name left to plan).

| Handler | Effect |
|---------|--------|
| `dragenter` / `dragover` | When the drag carries `ref` **and** the composer is not compacting: `preventDefault()`, `dropEffect = "copy"`, show the drop affordance (state set only on change). Otherwise leave the event alone. |
| `dragleave` | Clear the affordance only when `relatedTarget` is outside the card (the same containment guard as the Files tree container and the pane host). |
| `drop` | Run § Behavior › `onComposerDrop`. |
| document `dragend` / `drop` | Clear the affordance. A cancel (Escape, or a release elsewhere) ends here, because `dragend` fires on the source, not on the composer (D18). |

### 4. Precedence between composer and pane host

The pane host (`hooks/use-external-pane-drop.ts`, mounted on `TabPanelHost`'s area) receives the
same bubbling events after the composer does. Contract:

- If the event target is inside a composer drop zone **and** the drag carries `ref`, the host
  treats the pointer as over **no pane**. It sets `preview = null`, does not `preventDefault`, and
  does nothing on `drop`. This holds whether or not the composer accepts (it refuses while
  compacting, D9), so a `ref`-carrying drag released over the composer **never** falls through to
  an open or split.
- Without that check the host's last preview would stick when the pointer moves from a pane body
  onto the composer. The host's own `dragleave` guard does not fire for a move that stays inside
  the host.
- A drag that does **not** carry `ref` (chat rows, timeline file links) is unaffected. Over the
  composer it is still a pane drop, exactly as today (D4, D18).

### 5. Pure helpers (unit-tested; Node test env, no DOM)

| Signature (shape only) | Purpose |
|------------------------|---------|
| `relativeRefPath(absPath, root) → string \| null` | Strict workspace-relative path. `null` when `root` is empty or still starts with `~`, or when `absPath` is not strictly inside `root` on a **segment boundary**. Preserves a trailing `/` (directory). |
| `formatRefToken(relPath) → string` | D7 quoting: bare, unless it contains whitespace or a backtick, in which case it is wrapped in a backtick code span. |
| `planInsertion(text, selStart, selEnd, token) → { start, end, insert, caret }` | D3 and D13 smart spacing. Replace `[selStart, selEnd)` with `insert` (the token plus any spacing); `caret` is where the caret lands afterwards. |

## Behavior & algorithms

### Root resolution

```
root(session) = normalizeCwd(session.cwd || "~", homeDir)   // homeDir from server_info, never derived
                with any trailing "/" removed
if root starts with "~"  → unresolvable (homeDir not known yet) → refuse (D8)
```

This is the same normalisation `open-chat-tab.ts` uses for the chat tab's `workspaceCwd` and that
the Files tree uses for its root (`FileExplorer`'s re-root effect). For a composer in the workspace
in view, it equals the explorer's `rootPath`. The composer resolves the root from **its own
session**, never from the explorer store, so a mismatch refuses instead of producing a wrong
relative path.

### `relativeRefPath`

```
function relativeRefPath(absPath, root):
    if root is empty or starts with "~": return null
    isDir   = absPath ends with "/"
    p       = absPath without trailing "/"
    if not p.startsWith(root + "/"): return null        // segment boundary: "/repo2/x" is NOT under "/repo"
    rel     = p.slice(len(root) + 1)
    if rel is empty: return null                        // the root itself (not draggable anyway)
    return isDir ? rel + "/" : rel
```

The existing `lib/paths.ts` `relativeToRoot` cannot be reused as-is. It returns the input unchanged
when the path is not under the root, which would insert an absolute path and violate D8. It also
does no segment-boundary check. See TODO(verify) #4.

### `formatRefToken`

```
function formatRefToken(rel):
    if rel has no whitespace and no "`": return rel
    fence = "`" repeated (longest run of "`" in rel) + 1 times
    pad   = (rel starts or ends with "`") ? " " : ""
    return fence + pad + rel + pad + fence
```

The fence-length and padding rule is the CommonMark code-span rule, so a backtick inside the path
still yields one code span. Newlines in a file name count as whitespace and are wrapped like any
other.

### `planInsertion` (smart spacing, D13)

```
function planInsertion(text, s, e, token):
    before = s > 0 ? text[s-1] : none
    after  = e < len(text) ? text[e] : none
    lead   = (before exists and before is not whitespace) ? " " : ""
    trail  = (after is none or after is not whitespace) ? " " : ""
    insert = lead + token + trail
    return { start: s, end: e, insert, caret: s + len(insert) }
```

- Empty draft: `insert = token + " "`, with no leading space.
- Start of a line (preceding `\n`): no leading space.
- Caret before existing whitespace: no trailing space, so nothing is doubled.
- A selection `[s, e)` is replaced, and spacing is judged from the characters outside it (D3).

### `onComposerDrop`

```
function onComposerDrop(event):
    if drag does not carry ref: return                 // not ours; host handles it (§ Precedence)
    clear affordance
    if compacting: return                              // D9 — unreachable in practice: dragover never accepted
    event.preventDefault()
    abs = event.dataTransfer.getData(ref MIME).trim(); if abs empty: return
    rel = relativeRefPath(abs, root(session))
    if rel is null:
        show inline notice "Not inside this workspace"   // D8, D17 — the composer's inline error line
        return                                           // draft untouched
    el  = textarea
    { start, end, insert, caret } = planInsertion(el.value, el.selectionStart, el.selectionEnd, formatRefToken(rel))
    focus(el)                                          // D12
    el.setSelectionRange(start, end)
    ok = document.execCommand("insertText", false, insert)   // native undo (D11); fires input → onChange
    if not ok:
        el.setRangeText(insert, start, end, "end")     // fallback (D11) — no native undo entry
        run the composer's normal change pipeline with el.value
    el.setSelectionRange(caret, caret)
    focus the owning pane (layout store focusPane)     // see note
```

- **Change pipeline (D16).** The successful `execCommand` path reaches the composer's existing
  `onChange` (`handleTextareaChange`), and the fallback must call the same function. Either way the
  draft is written to `draft-store` (`setDraft(sessionId, …)`), the textarea autosizes, the
  slash-command highlight is recomputed, `shouldOpenMenu` re-evaluates the menu, and
  `compactError`/`pickError` are cleared. A drop after a partial `/co` therefore yields `/co <path> `
  and the menu closes. Because D8 guarantees no token starts with `/`, a drop into an empty draft
  can never open the menu.
- **Turn running (D10).** No special case: steer mode accepts the edit like typing.
- **Pane focus.** A drop fires no `pointerdown`, so `TabPanelHost`'s click-to-focus-pane does not
  run. The drop focuses the owning pane explicitly, which keeps "where the caret is" and "focused
  pane" consistent. This is derived from D12; see TODO(verify) #3.
- **Multiple composers.** Every chat pane's composer is its own zone, and the drop goes into the one
  under the pointer. Hidden tabs' composers stay mounted but are not hit-testable, so they cannot
  receive it.

### Affordance (D12)

While a `ref` drag is over a non-compacting card, the card shows the same accent border as
`.card:has(.textarea:focus)` (`Composer.module.css`). It is a class toggle, with no new element
inside the card, because the highlight mirror must stay aligned with the textarea. The class is held
without animation under `prefers-reduced-motion: reduce`, following the existing `.card.flash` rule.
There is no affordance while compacting (D9).

## Data & persistence touchpoints

- **None persisted.** The only state write is the session's draft in `stores/draft-store.ts`
  (`drafts[sessionId]`), which is in memory only.
- Transient UI state: a per-composer "drag over" boolean, and the existing inline-error slot reused
  for the refusal notice (D17).
- Do not log path text anywhere.

## Error handling & edge cases

| Condition | Expected behavior | Brief |
|-----------|-------------------|-------|
| Dropped row is a folder | Token ends with `/` | D6 |
| Path contains whitespace or a backtick | Wrapped in a backtick code span; every other path stays bare | D7 |
| Path not strictly under the session root (incl. sibling prefix `/repo2` vs `/repo`) | Refused: draft untouched, inline notice until the next edit | D8, D17 |
| Session root is `~…` and `homeDir` not yet known | Refused, same notice | D8 |
| Textarea has a selection | Selection replaced; spacing judged outside it | D3, D13 |
| Caret glued to a word / before whitespace / empty draft | Leading space if glued; no doubled trailing space; no leading space when empty | D13 |
| Composer compacting (`readOnly`) | No affordance, no insert, and no pane open/split (host still yields) | D9 |
| Turn running | Inserts as when idle | D10 |
| Ctrl/Cmd+Z after a drop | Removes exactly the dropped insertion (execCommand path); fallback path documented as no native undo | D11 |
| Partial slash command, menu open | Menu recomputed from the new draft (closes once whitespace is inserted) | D16 |
| Drag cancelled (Escape) or released elsewhere | Affordance cleared via document `dragend`/`drop`; nothing inserted | D18 |
| Pointer moves pane body → composer mid-drag | Pane preview disappears; composer affordance appears | § Precedence |
| Chat row / timeline file link (no `ref`) released over the composer | Pane drop exactly as today | D4, D18 |
| OS files dragged over the composer | Not ours: no affordance, no handling (non-goal) | — |
| Very long path | Inserted verbatim; textarea autosizes to its existing max height, then scrolls | — |
| Same row dropped twice | Inserted twice; each drop is an independent edit | — |
| `set_editor_text` replaces the draft right after a drop | Last write wins; not coordinated | — |
| Drop onto an unfocused pane's composer | Textarea focused, owning pane becomes the focused pane | derived (D12) |

## Dependencies on other specs

- [workspace-split-panes.md](workspace-split-panes.md). The path-ref payload sits beside its
  sidebar-to-pane transport. § Drag sources gains a note that it is composer-only and is never
  pane-droppable, and § Precedence above amends the host's hit-test.
- [file-explorer-move.md](file-explorer-move.md). Row drags keep their move semantics; only an extra
  payload is added, and folders widen `effectAllowed`.
- [composer-ui.md](composer-ui.md). The composer card gains a drop zone. This is distinct from the
  "outer drop zone for images" mentioned there, which stays unimplemented.

## Acceptance criteria

From the brief, unchanged in meaning; each is testable by unit test (pure helpers) or manual smoke
(DnD; the vitest env has no DOM).

- [x] Given a file row and a composer with text, when I drop the row onto any part of the composer
      card, then its workspace-relative path is inserted at the textarea's last caret with smart
      spacing, the textarea is focused with the caret after the insertion, and no file tab opens and
      no pane splits (D1, D3, D4, D12, D13). *(Chromium: textarea, toolbar, attachment strip.)*
- [x] Given a folder row, the inserted text ends with `/` (D6). Given a path containing whitespace
      or a backtick, it is wrapped as a code span, and no other path is (D7). *(Whitespace live;
      backtick by unit test.)*
- [x] Given a selection, a drop replaces it (D3). Given an empty draft, there is no leading space
      (D13).
- [ ] After a drop, one Ctrl/Cmd+Z removes exactly the dropped text and nothing typed earlier, in
      Chrome, Firefox and Safari (D11). *(Chromium verified in the real composer; Firefox and Safari
      not run: no such browser on the implementer's host.)*
- [x] Given `/co` with the slash menu open, a drop yields `/co <path> ` and the menu closes (D16).
- [x] While compacting, hovering or dropping a row shows no outline, inserts nothing, and opens or
      splits nothing (D9).
- [ ] While a turn is running, a drop inserts exactly as when idle (D10). *(No special case in the
      code; not exercised live: the mock turn ends in ~5 ms.)*
- [x] Given a path not strictly under the session's root (including a sibling-prefix directory), or
      an unresolvable `~` root, a drop leaves the draft unchanged and shows the inline notice until
      the next edit (D8, D17). *(Outside, sibling prefix and the root itself live; unresolved `~` by
      unit test.)*
- [x] The composer outline appears only for Files-tree row drags, and clears on leave, drag-end,
      drop and Escape. Moving from a pane body onto the composer removes the pane preview (D12, D18,
      § Precedence).
- [ ] Regressions: a file row dropped on a pane body outside the composer still opens or splits; a
      chat row or timeline file link released over the composer is still a pane drop; row-to-row
      move (files and folders) and OS-file upload in the tree still work (D4, D5). *(Verified live,
      except the OS-file upload drop and the timeline file link, which the harness could not
      deliver; the former is untouched code gated on `"Files"`, the latter carries no path-ref.)*
- [x] No daemon, protocol or capability-flag change; works against any daemon version (D15).
- [x] Unit tests cover `relativeRefPath` (inside, sibling prefix, root itself, trailing `/`, `~`
      root, empty root), `formatRefToken` (bare, space, tab/newline, inner backtick, leading or
      trailing backtick) and `planInsertion` (empty, glued before, glued after, whitespace either
      side, selection replace, start of line).

## TODO(verify)

1. **Directory flag encoding.** *Resolved:* a trailing `/` on the path-ref value, as specified; no
   reason to revisit appeared.
2. **`execCommand('insertText')` spike.** *Resolved for Chromium* (`swe/notes/composer-path-drop-spike.md`):
   inside a native `drop`, after `focus()` + `setSelectionRange`, it inserts, fires the input event
   React's `onChange` sees, makes one undo step, and the store round-trip does not overwrite it.
   Fallback (`setRangeText` + the shared change pipeline) is consistent but **loses the whole undo
   history**, not only the insertion. Detection rule: fall back when `execCommand` returns false,
   throws, or leaves the value unchanged. **Open for Firefox and Safari**, which were not available.
3. **Pane focus on drop.** *Resolved, on by default:* `owningPaneId` and `workspaceCwd` are threaded
   from `ChatPanel` into `Composer`, and the drop calls `focusPane`. Confirmed live: a drop into an
   unfocused split pane's composer moved the focused-pane marker to it.
4. **`relativeToRoot` sibling-prefix bug.** *Still open (follow-up).* `lib/paths.ts`'s
   `relativeToRoot("/repo2/x", "/repo")` yields `"2/x"`, which also affects the tree's existing *Copy
   Relative Path*. This feature uses its own strict `relativeRefPath`. Fixing *Copy Relative Path* is
   out of scope.
5. **Never-focused composer with a non-empty draft.** *Resolved:* Chromium reports a caret at `0` for
   a textarea mounted with a non-empty controlled value, and the end of text for one whose value was
   set after mount, so the caret cannot be trusted. Rule: until the textarea first receives focus,
   insert at the end of the text (`decideComposerDrop`'s `neverFocused`).
