# Task 004 — Drag-to-split source wiring for links and images — Summary

- **Sprint:** sprint-051-file-link-rendering
- **Completed:** 2026-08-05
- **Status:** done

## What was implemented
Made a rendered local `FileLink` and a resolved (`ready`) local `InlineImage` native-HTML5 drag
sources carrying the same `EXTERNAL_DRAG_MIME.path` payload a Files-tree row drag carries, mirroring
`FileExplorer.tsx`'s `handleDragStartRow` pattern. Rather than duplicating the two-line
`setData`/`effectAllowed` handler inline in both components (as the Files tree and `SessionList.tsx`
each do independently today), it was extracted once into a shared `pathDragStartHandler(path)` in
`external-drag.ts` — the module `EXTERNAL_DRAG_MIME` itself already lives in — so it is a pure,
directly-testable closure (`{ dataTransfer } => void`) rather than an untestable inline JSX handler,
and both drag sources for this feature share one implementation. No drop-side code was touched:
`use-external-pane-drop.ts`'s `applyExternalDrop` is already generic over the `path` kind.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/external-drag.ts` | added pure `pathDragStartHandler(path)` |
| `packages/web-client/src/features/workspace/external-drag.test.ts` | added `pathDragStartHandler` describe block (2 cases) |
| `packages/web-client/src/timeline/FileLink.tsx` | `local` anchor is now `draggable` with `onDragStart={pathDragStartHandler(path)}` |
| `packages/web-client/src/timeline/InlineImage.tsx` | `ready` `<img>` is now `draggable` with `onDragStart={pathDragStartHandler(view.path)}` |

No changes to `pane-dnd.ts`, `use-external-pane-drop.ts`, or `EXTERNAL_DRAG_MIME` itself — confirmed
by reading them; they are already generic over the `path` kind.

## How it satisfies the scope
Implements `file-link-rendering.md` § Drag-to-split: the rendered element is a drag source carrying
the identical `path`-kind payload `workspace-split-panes.md` § Drag sources already defines for a
Files-tree row — no new payload kind, no new drop region, no new drop-resolution logic. Per the
task's Known Limitations note, a directory-target link is knowingly not guarded against here (no
existence/type pre-check before drag, matching the pre-existing click behavior).

## Build & test results
```
$ npm run typecheck
tsc -b   →   exit 0, no errors

$ npm run build:web-client
tsc -b (VITE_TARGET=web) && vite build   →   success

$ npx vitest run packages/web-client/src/timeline packages/web-client/src/features/workspace packages/web-client/src/hooks/use-external-pane-drop.test.ts
Test Files  15 passed (15)
Tests  292 passed (292)   (external-drag.test.ts: 10, up from 8 pre-task)

$ npm run lint
oxlint   →   exit 0 (one shadowed-variable warning introduced and fixed during this task's own
  verification pass — see Follow-ups; no remaining warnings on any file touched)
```

## Acceptance criteria
- [x] Dragging an actionable file link onto a pane's edge splits that pane and opens the file into
      the new split, identical to dragging the same path from the Files tree — the payload
      (`EXTERNAL_DRAG_MIME.path`) and drop-side handling are byte-identical to the Files-tree path,
      verified by `pathDragStartHandler`'s unit tests plus the pre-existing, unmodified
      `use-external-pane-drop.test.ts` drop-side suite.
- [x] Dragging onto a pane's center region opens/moves into that pane without splitting — unchanged
      drop-side behavior (`use-external-pane-drop.test.ts`, untouched).
- [x] Dragging an actionable file link whose file is already open elsewhere reuses that tab — same
      pre-existing `applyExternalDrop` "already open" path, unmodified.
- [x] Dragging a resolved inline image behaves identically to a file link for all three cases above
      — both now call the same `pathDragStartHandler`.
- [x] Dragging an `external` link or a remote image does not carry `EXTERNAL_DRAG_MIME.path` — the
      `external`/remote branches in `FileLink`/`InlineImage` render before the draggable branch and
      never attach `draggable`/`onDragStart` at all (verified by reading the component branching;
      `externalDragKind` is unmodified and already covered by its own existing tests).
- [x] `npm run build`, `npm run typecheck`, `npm run lint` pass.

## Follow-ups / TODO(verify)
- The initial version of the new test file shadowed the module's existing `transfer` test helper
  with a same-named destructured local; caught by `npm run lint` (`no-shadow`) during this task's
  own gate run and fixed by renaming to `dataTransfer` before completing.
- Manual verification (drag onto edge/center/already-open-elsewhere) is deferred to task-006's
  closing E2E pass, per that task's own scope.
</content>
