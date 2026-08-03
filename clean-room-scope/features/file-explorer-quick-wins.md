# File Explorer — Quick Wins (single PR)

> Triage report, not an implementation. Source: user bug/feature list (2026-07-30), cross-referenced
> against the current `web-client` Files tab implementation. Every item below ships in **one PR**,
> **web-client only** — no protocol, server, or daemon change required. See companion report
> `features/file-explorer-improvements.md` for the items that don't qualify as quick wins.

## Why these are quick wins

The daemon's file-mutation surface today is exactly three RPCs, all already wired and consumed:
`file_explorer_request` (list/read), `file_create_request` (create-exclusive `wx`, non-recursive
`mkdir` — `packages/server/src/files/file-explorer.ts`), `file_delete_request`, plus the binary
upload/download frames (`use-file-transfer.ts`). Every item in this report is achievable by
composing those existing RPCs and client-side state — no new wire schema, no new daemon handler.

## Current implementation (for context)

- `stores/explorer-store.ts` — tree-expansion state only (`rootPath`, `expanded`, `draft`); no
  concept of "selection".
- `features/files/FileExplorer.tsx` — renders the virtualized tree, owns upload/drop, dispatches
  file-open (`handleOpenFile`) and draft-create (`submitDraft`).
- `features/files/TreeNode.tsx` — presentational row; directory toggles expand, file opens a tab;
  no `title` attribute, no active-file styling, no selection concept.
- `features/files/FileContextMenu.tsx` — per-row Radix menu, one instance shared across rows via
  `ui-store.fileMenu`. Currently always shows New File / New Folder + (file-only) Download +
  Delete — no Open/Rename/Copy-path/Cut/Copy/Paste, no directory-vs-file distinction on the create
  actions, no empty-space variant.
- `stores/tab-store.ts` — `close(id)` closes exactly one tab by id; no "close by path prefix"
  helper.
- `stores/ui-store.ts` — `collapsedWorkspaces: Set<string>`, already used by the sidebar's
  workspace tree; starts empty (nothing collapsed) every connect.
- `hooks/use-session-restore.ts` — picks the most-recently-active session/workspace on connect but
  never touches `collapsedWorkspaces`.
- `features/sessions/SessionContextMenu.tsx` — per-session archive/delete via
  `client.agent(id).archive()` / `.delete()`; no workspace-level (multi-session) equivalent.

## Scope for this PR

| # | User item | Fix |
|---|---|---|
| 1 | Show full file name on hover | Add `title={row.name}` (or full `row.path`) to the row in `TreeNode.tsx`. Native browser tooltip — no new component. |
| 2 | Collapse inactive workspaces on startup | In `use-session-restore.ts`, once the target workspace is chosen (existing `first.cwd` logic), seed `ui-store.collapsedWorkspaces` with every *other* workspace cwd from the restored session groups. |
| 3 | Delete an entire workspace | New action on `WorkspaceGroupHeader`'s row menu (or a "⋮" added to the header, mirroring `SessionContextMenu`'s pattern): confirm, then loop `client.agent(id).delete()` over every session in that workspace group, then drop them from `session-store` and close their tabs via `tab-store`. **Product decision needed and already surfaced to the user**: this deletes conversations (agent records) grouped under the cwd — it does **not** touch files on disk. Confirm copy must say so explicitly to avoid the user reading "delete workspace" as "delete the folder." |
| 4 | Close tabs when a file is deleted | Add a `closeTabsByPathPrefix(path)` helper to `tab-store.ts` (closes any `file`/`diff`/`molecule` tab whose `data.path === path` or starts with `path + "/"`, for recursive directory deletes). Call it from `FileContextMenu.tsx`'s `remove()` after a successful `file_delete_request`. |
| 6 | Highlight the active file in the Explorer | `FileExplorer.tsx` reads `useTabStore((s) => s.activeTabId)`/`tabs` to resolve the active tab's `path` (when its `kind` is `file`/`molecule`), passes an `active` flag down to `TreeNode`, which applies the same "active row" CSS recipe already used by `SessionList.module.css` (`background: var(--pi-color-surfaceSunken)` + `box-shadow: inset 2px 0 0 var(--pi-color-accent)`). |
| 7 | Create inside the selected directory | `explorer-store.ts` gains a `selected: string | null` field + `setSelected(path)`, set on row click (in addition to existing open/toggle behavior) and cleared on workspace switch. The header's New File/New Folder buttons and the empty-space menu (item 12) target `selected` (if it's a directory) or its parent (if it's a file) instead of always `rootPath`. |
| 9 (partial) | Open / Copy Absolute Path / Copy Relative Path | **Open**: new menu item calls the existing open-tab dispatch (`handleOpenFile`'s logic, lifted into a small shared helper so the context menu and the row click stay identical). **Copy Absolute Path**: `copyText(menu.path)`. **Copy Relative Path**: `copyText(menu.path.slice(rootPath.length).replace(/^\//, ""))` — needs `rootPath` threaded into `FileContextMenu` (currently not read there). |
| 11 | Hide New File/New Folder on a file's own context menu | `FileContextMenu.tsx` currently renders both unconditionally (lines ~94-99). Wrap them in `{menu.isDirectory && ( … )}`. |
| 12 | Empty-space context menu: New File, New Folder, Copy Current Directory Path, Copy Current Directory Relative Path | `ui-store.fileMenu` needs a `background: boolean` variant (opened by right-clicking the tree's empty area below the last row, not a specific row) carrying the *current directory in view* (`rootPath`, or `selected` from item 7 if a directory is selected). `FileContextMenu` renders a distinct item set for this variant: New File, New Folder, Copy Current Directory Path, Copy Current Directory Relative Path (same `copyText` helper as item 9). |

### New shared pieces this PR introduces

- `lib/clipboard.ts` — `copyText(text)`: tries `navigator.clipboard.writeText`, falls back to a
  hidden-textarea `execCommand("copy")` when the Clipboard API is unavailable (plain-http access
  to a self-hosted daemon over the LAN is not a secure context, so `navigator.clipboard` is
  `undefined` there — a real deployment condition for this app, not a hypothetical).
- A shared "open path as a tab" function so item 9's **Open** menu action and the existing row
  click in `FileExplorer.tsx` can't drift (today's `handleOpenFile` is local to `FileExplorer.tsx`).
- `tab-store.ts`: `closeTabsByPathPrefix(path)`.
- `explorer-store.ts`: `selected` + `setSelected`.
- `ui-store.ts`: `fileMenu` grows a `background` discriminant (or a sibling `emptyMenu` field —
  implementer's call) carrying the directory-in-view path instead of a row path.

### Out of scope for this PR (do not implement here)

- Anything requiring a new daemon RPC (rename, move, copy-on-disk, write) — see
  `features/file-explorer-improvements.md`. *(Status 2026-08-03: the `write` and `move`/rename
  RPCs both shipped after this PR was scoped; copy-on-disk still has no RPC and is no longer a
  tracked item.)*
- Drag-and-drop (item 8) — explicitly flagged by the user as probably not a quick win; confirmed
  by triage. *(Shipped in sprint 046; see `features/file-explorer-improvements.md` § 8.)*
- Multi-select in the tree — none of the above items need it; do not add it speculatively.

### Verification plan (when this PR is implemented)

No new protocol surface, so no protocol/server tests. Web-client:
- Unit tests for the pure logic: `closeTabsByPathPrefix` (prefix + exact-match cases, directory
  delete closing multiple nested tabs), relative-path derivation for items 9/12, the
  `collapsedWorkspaces` seeding logic in isolation.
- Live smoke test in-browser: hover tooltip, workspace collapse on fresh connect, delete workspace
  (confirm dialog wording, sessions actually gone, tabs closed), delete a file with an open tab
  (tab closes), active-file highlight follows tab switches, new-file/new-folder targets the
  selected directory, file-only menu hides New File/New Folder, empty-space menu shows the four
  items, all four copy actions produce the expected clipboard content (paste into an address bar
  to check).
