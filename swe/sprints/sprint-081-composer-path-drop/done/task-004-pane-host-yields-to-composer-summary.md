# Task 004 — Pane drop host yields to a composer drop zone for path-ref drags — Summary

- **Sprint:** sprints/sprint-081-composer-path-drop
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
`external-drag.ts`: `composerDropProps()` (single definition of the `data-composer-drop` attribute),
`isInComposerDrop(target)` (the reader, beside it) and the pure `yieldsToComposer(types, inside)`.
`useExternalPaneDrop`: `onDragOver` clears the preview and returns without `preventDefault` when yielding;
`onDrop` clears the preview and returns without acting. Computed per event. The marker is already
spread on `Composer`'s `.card` (the one-line part of task-005 that this task's manual check needs).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/external-drag.ts` | modified |
| `packages/web-client/src/features/workspace/external-drag.test.ts` | modified (+4 tests) |
| `packages/web-client/src/hooks/use-external-pane-drop.ts` | modified |
| `packages/web-client/src/features/chat/Composer.tsx` | modified (marker spread on `.card`) |

## Build & test results
```
$ npx vitest run .../external-drag.test.ts      # 19 passed
$ npm run build:web-client / typecheck          # success
$ npm run lint                                  # no warnings in changed files
$ npx oxfmt <changed files>                     # clean
```
Manual (dev stack, Chromium, real CDP drag events; settled with several dragover events per position
because the hidden headless tab lags React's render by one event, which also affects the unmodified
pane preview):
- File row: over pane body -> 1 preview; moved onto composer (card body and toolbar) -> 0 previews, host
  does not `preventDefault`; back to body -> 1 again.
- Folder row (move + path-ref only): 0 previews anywhere, including over the composer.
- Chat row (no path-ref) over the composer: preview stays 1 (still a pane drop).

## Acceptance criteria
- [x] `yieldsToComposer`: true only for inside + ref (unit tests)
- [x] Hook: no preview and no `preventDefault` while yielding; preview recomputed on re-entering a body (manual)
- [x] Regression: chat-row drag over composer still previews. Timeline-link drags carry no path-ref, so
      `yieldsToComposer` is false for them (unit test); not exercised through a real timeline link.

## Follow-ups / TODO(verify)
- With task-005 not yet landed, a file released on the composer currently does nothing (host yields,
  nothing accepts); task-005 supplies the accepting handler.
