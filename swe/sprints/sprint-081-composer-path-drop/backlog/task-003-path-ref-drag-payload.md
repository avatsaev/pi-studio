# Task 003 — Drag transport: composer-only path-ref payload on every Files-tree row

- **Sprint:** sprint-081-composer-path-drop
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (features/workspace, features/files)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Every draggable Files-tree row, file or folder, carries a composer-only path-ref payload. No pane,
move or upload behaviour changes.

## Context / why

D5: a third payload readable only by the composer, so folders (which have no pane payload) can
reach it, and so pane open/split stays untouched.

**Planning-time refinement to the spec (applied to the spec in task-006).** Spec § Public contract 1
reads "`ref` is added to the module's kind discrimination". Doing that literally makes
`externalDragKind` return `"ref"` for a folder transfer (`MOVE_MIME` + ref only), so a pane host
gating on `externalDragKind(...) !== null` would start previewing folder drops. That is exactly what
D5 and workspace-split-panes.md § Drag sources forbid. So `ref` gets its **own** MIME constant and
helpers, and stays **out** of `ExternalDragKind` / `KINDS` / `readExternalDrag`, which remain the
pane-host vocabulary.

## Scope references

- swe/features/composer-path-drop.md § Public contract 1–2
- swe/features/workspace-split-panes.md § Drag sources (the directory restriction)
- swe/grills/drag-file-into-composer.md D5, D6
- packages/web-client/src/features/workspace/external-drag.ts (+ `external-drag.test.ts`)
- packages/web-client/src/features/files/FileExplorer.tsx (`handleDragStartRow`, `MOVE_MIME`, the
  container and row `onDragOver`/`onDrop`)

## What to build

- `external-drag.ts`:
  - `PATH_REF_MIME = "application/x-pi-studio-path-ref"`
  - `hasPathRef(types: readonly string[]) → boolean`
  - `encodePathRef(absPath: string, isDirectory: boolean) → string`: a directory gets exactly one
    trailing `/`
  - `readPathRef(types, read) → string | null`: trimmed, `null` when absent or blank
  - Doc comment: why this kind is not an `ExternalDragKind`
- `FileExplorer.handleDragStartRow`: also `setData(PATH_REF_MIME, encodePathRef(path, isDirectory))`
  for every row. `effectAllowed` becomes `"copyMove"` for **folders** too (was `"move"`). Files
  unchanged.
- Confirm by reading that the tree's own row-move and OS-upload drop handlers gate on `MOVE_MIME` /
  `"Files"` only, so the extra type changes nothing there.

## Out of scope

- Pane host precedence (task-004)
- Composer drop handling (task-005)

## Acceptance criteria

- [ ] `externalDragKind([MOVE_MIME, PATH_REF_MIME])` (folder row) → `null`;
      `externalDragKind([MOVE_MIME, path MIME, PATH_REF_MIME])` (file row) → `"path"`
- [ ] `readExternalDrag` ignores the ref MIME; `hasPathRef`/`readPathRef` round-trip
      `encodePathRef` for files and folders, including a folder input that already ends with `/`
- [ ] Manual (dev stack): row-to-row move of a file and a folder still works; OS-file upload onto the
      tree still works; a folder dragged over a pane body shows **no** split preview; a file dragged
      over a pane body still previews and opens or splits

## Test / verification plan

- Extend `packages/web-client/src/features/workspace/external-drag.test.ts`; run
  `npx vitest run packages/web-client/src/features/workspace/external-drag.test.ts`
- `npm run build:web-client`, `npm run typecheck`; `npx oxfmt` on changed files
- Manual checks above on `npm run dev:daemon` + `npm run dev -w packages/web-client`
