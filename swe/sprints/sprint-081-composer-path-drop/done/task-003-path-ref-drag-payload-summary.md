# Task 003 — Drag transport: composer-only path-ref payload on every Files-tree row — Summary

- **Sprint:** sprints/sprint-081-composer-path-drop
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
`external-drag.ts` gained `PATH_REF_MIME`, `hasPathRef`, `encodePathRef` (folder gets exactly one trailing
`/`) and `readPathRef`, kept OUT of `ExternalDragKind`/`KINDS`/`readExternalDrag` (planning refinement:
otherwise a pane would preview a folder drop). `FileExplorer.handleDragStartRow` now also sets the
path-ref for every row and `effectAllowed = "copyMove"` for folders too.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/external-drag.ts` | modified |
| `packages/web-client/src/features/workspace/external-drag.test.ts` | modified (+5 tests) |
| `packages/web-client/src/features/files/FileExplorer.tsx` | modified |

## How it satisfies the scope
Tree row-move / OS-upload handlers gate on `MOVE_MIME` / `"Files"` only (read: `handleDrop`,
`handleDragOver`, row `onDragOver`), so the extra type changes nothing there.

## Build & test results
```
$ npx vitest run .../external-drag.test.ts       # 15 passed
$ npm run build:web-client / typecheck / lint    # success, no new warnings
$ npx oxfmt <changed files>                      # clean
```
Manual (mock dev daemon :6790 + vite :5180, scratch workspace /tmp/ps081-ws, Chromium 150, real CDP drag events):
- File row transfer types: move + open-path + path-ref. Folder row: move + path-ref only.
- Folder dragged over a pane body: 0 preview elements; drop did nothing (no tab, no split).
- File dragged over a pane body: 1 preview element; drop opened `a.ts` in a tab.
- Row-to-row move: file `README.md` -> `my docs` and folder `lib` -> `my docs` both moved on disk.
- OS file drag over tree row: dragover carries `Files`, tree `preventDefault`s it (still accepted). The
  `drop` event itself was never delivered by CDP's file drag in this headless Chromium, so the actual
  upload could not be exercised; the upload branch is untouched code gated on `"Files"`.

## Acceptance criteria
- [x] `externalDragKind` folder -> null, file -> "path" (unit test)
- [x] `readExternalDrag` ignores ref; `hasPathRef`/`readPathRef` round-trip incl. a folder already ending `/` (unit test)
- [~] Manual: row move (file+folder) OK; folder over pane no preview OK; file over pane previews and opens OK; OS-file upload drop not exercisable here (dragover acceptance verified only)

## Follow-ups / TODO(verify)
- OS-file upload drop should be eyeballed by a human once (task-006 cross-browser pass).
