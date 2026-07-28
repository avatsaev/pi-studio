# Task 004 — `molecule` tab kind, panel, and both entry points

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal
Wire the two ways a molecule viewer opens: clicking a supported file in the explorer, and the
TabStrip "+" menu's new "New molecule view" item.

## Background / why
Per `docs/molviewer-integration-scope.md` § 4.3, molecule tabs are their own `TabKind` with a
dedicated panel rather than riding `kind: "file"` through `FilePanel`:
- The "+"-menu tab has **no path**, while `FilePanel` is built entirely around one
  (`FilePanel.tsx:49-52` reads a path, detects a viewer kind, renders a File/Diff header).
- Nothing is lost by dropping that File/Diff toggle for molecule tabs: diff tabs are minted
  independently by the git Changes panel (`ChangesPanel.tsx:32-37`, `kind: "diff"`), so a `.pdb`'s
  git diff stays reachable exactly as today.

`FileExplorer.tsx`'s `handleOpenFile(path)` (lines 82-91) is the **only** site in the web-client that
opens a `kind: "file"` tab (grep-verified — every other `kind: "file"` hit is an unrelated
explorer-row/draft field). Note it has **two** callers: the file-row click and `submitDraft` (line
101, `if (kind === "file") handleOpenFile(created)`, which opens a newly created file). Branch
**inside `handleOpenFile`**, not at the click site, so creating a new `.pdb` in the tree routes to a
molecule tab for free.

`openNewTerminal` (`tab-store.ts:211-221`, numbered off the module-level `terminalCount` at line 206)
is the template for the counter-based empty-tab opener. Both `ICON_BY_KIND` (`TabStrip.tsx:33-38`)
and `PANEL_BY_KIND` (`panel-registry.ts:20-25`) are exhaustive
`Record<TabKind, …>`/`Record<Tab["kind"], …>`, so adding the kind makes the compiler name every site
that must be updated — verified there are exactly these two, plus the store itself.

The tab store has **no** persist middleware (`tab-store.ts:89`), so no migration concern for a new
kind.

## Scope references
- `docs/molviewer-integration-scope.md` § 2.2, § 2.4, § 3.1, § 4.3
- `clean-room-scope/features/workspace-ui.md` § tab model, § tab strip
- `clean-room-scope/features/file-explorer-transfer.md` § opening files
- `packages/web-client/AGENTS.md` § features/workspace, § stores

## What to build
- **`packages/web-client/src/stores/tab-store.ts`**:
  - `TabKind` (line 20) gains `"molecule"`.
  - `export interface MoleculeTabData { path: string | null }` next to `FileTabData` (lines 22-24)
    — **and add it to the `TabData` union at line 42**, otherwise `Tab.data` rejects
    `{ path: null }` and the new kind won't typecheck.
  - `tabIds` (lines 199-204) gains `molecule: (key: string | number) => \`mol-${key}\``.
  - `openNewMolecule(workspaceCwd: string): void` mirroring `openNewTerminal` (lines 211-221, which
    numbers off the module-level `terminalCount` at line 206): an equivalent module-level counter,
    `id: tabIds.molecule(\`new-${n}\`)`, `label: \`Molecule ${n}\``,
    `closable: true`, `data: { path: null }`, `workspaceCwd`. Add the same style of doc comment
    explaining that both the "+" menu and any future shortcut mint ids identically.
- **`packages/web-client/src/features/files/MoleculeViewerPanel.tsx`** (new) — a thin `PanelProps`
  adapter: read `(tab.data as MoleculeTabData).path`, compute `isActive` the way `TerminalPanel` does
  (compare `tab.id` to the store's `activeTabId`), render `<MoleculeViewer path={path}
  isActive={isActive} />`. No header, no File/Diff toggle. It owns the panel-filling height chain
  (`height: 100%; min-height: 0;`).
- **`packages/web-client/src/features/workspace/panel-registry.ts`** — add
  `molecule: lazy(() => import("../files/MoleculeViewerPanel.js").then((m) => ({ default: m.MoleculeViewerPanel })))`
  following the existing lazy-import style (lines 14-18) and register it in `PANEL_BY_KIND`.
- **`packages/web-client/src/features/files/FileExplorer.tsx`** — branch inside `handleOpenFile`
  (lines 82-91) on `isMoleculeFile(path)` (task-002): molecule files open
  `{ id: tabIds.molecule(path), kind: "molecule", label: <basename>, closable: true, data: { path } }`
  with the same `workspaceCwd: activeWorkspaceCwd || "~"` as today; every other file keeps today's
  exact `kind: "file"` behavior. Both callers (row click, `submitDraft:101`) then route correctly.
  Note the id namespace differs from `tabIds.file(path)`, so a molecule tab and a text tab for the
  same path can't collide.
- **`packages/web-client/src/features/workspace/TabStrip.tsx`**:
  - `ICON_BY_KIND` (lines 33-38) gains `molecule: Atom` (lucide `Atom`; confirm the export name in
    the installed `lucide-react` before using it — pick the closest existing molecular/atom glyph if
    absent).
  - `NewTabMenu` (lines 90-118) gains a third `DropdownMenu.Item` **after** "New terminal", matching
    the two existing items exactly (`className={styles.item}`, a 13 px icon with
    `className={styles.itemIcon}`), labelled `New molecule view`, calling `openNewMolecule(cwd)`.

## Out of scope
- Live file-change reload (tasks 006-008).
- Reopening molecule tabs after a reconnect/restore (terminals and chats have restore hooks; molecule
  tabs are not persisted — same as today's file tabs).
- Any change to `FilePanel`, `detectViewerKind`, or `VIEWER_BY_KIND`.
- A keyboard shortcut for the new tab type (`use-shortcuts.ts` untouched).

## Acceptance criteria
- [ ] Clicking a `.pdb`/`.cif`/`.xyz`/… row in the explorer opens a molecule tab that renders the
      structure; clicking a `.ts`/`.md` row still opens the normal file tab with its existing viewer.
- [ ] Creating a new `.pdb` via the tree's inline new-file draft opens it as a **molecule** tab
      (`submitDraft`'s `handleOpenFile(created)` call goes through the same branch).
- [ ] "+" → "New molecule view" opens an empty molecule tab showing molviewer's own empty state, and
      repeated use mints `Molecule 1`, `Molecule 2`, … without id collisions.
- [ ] Molecule tabs show the atom icon in the strip, are closable, drag-reorder like every other tab,
      and are scoped to the active workspace (`workspaceCwd` set).
- [ ] Switching to another tab and back preserves the loaded structure and camera (no remount).
- [ ] Opening the same molecule file twice focuses the existing tab instead of duplicating it.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- `packages/web-client/src/stores/tab-store.test.ts` **already exists** (8 tests covering
  open/activate/close/`switchWorkspace` against `session-store`) and needs no client mock — add a
  case there asserting `openNewMolecule` opens a tab with `kind: "molecule"`, `data: { path: null }`,
  an incrementing label, and the `mol-new-<n>` id shape.
  Run: `npx vitest run packages/web-client/src/stores/tab-store.test.ts`.
- Manual, against a real daemon (see task-010's setup note — the download path requires the
  production daemon): both entry points, tab switching, close, and reorder.

## Notes
- `closeTab` (`tab-store.ts:257-263`) only has special handling for `kind === "chat"`; molecule tabs
  need nothing there.
- Keep `MoleculeTabData.path` nullable rather than inventing a second tab kind for the empty case —
  the panel and viewer already branch on exactly that one field (task-003).
