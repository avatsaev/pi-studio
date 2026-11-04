# Task 005 — Composer drop zone: affordance, insertion, refusal, focus — Summary

- **Sprint:** sprints/sprint-081-composer-path-drop
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
- `composer-path-drop.ts`: pure `decideComposerDrop` (ignore / refuse / insert; applies the spike's
  never-focused rule: caret ignored, insert at end until the textarea first receives focus).
- `Composer.tsx`: card is the drop zone (`composerDropProps`, `onDragEnter/Over/Leave/Drop`); `dragOver`
  state drives `.card.dropTarget` (never while compacting); a document `dragend`/`drop` listener (attached
  only while hovering) clears it; `applyDraftChange` extracted from `handleTextareaChange` so typing and the
  fallback share one pipeline; `insertPathAt` = focus -> `setSelectionRange` -> `execCommand("insertText")`
  (success = returned true AND value changed), else `setRangeText` + `applyDraftChange`; caret set to
  `plan.caret`; owning pane focused via `useLayoutStore.focusPane`; refusal reuses the `pickError` inline
  line ("Not inside this workspace"), cleared by the next edit; root = `refRoot(session.cwd, homeDir)`.
- `ChatPanel.tsx` threads `workspaceCwd` + `owningPaneId` into `Composer` (spec TODO #3, default on).
- `Composer.module.css`: `.card.dropTarget` reuses the accent border, transition off under reduced motion.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/composer-path-drop.ts` | modified (+`decideComposerDrop`) |
| `packages/web-client/src/features/chat/composer-path-drop.test.ts` | modified (+8 tests, 30 total) |
| `packages/web-client/src/features/chat/Composer.tsx` | modified |
| `packages/web-client/src/features/chat/ChatPanel.tsx` | modified |
| `packages/web-client/src/features/chat/Composer.module.css` | modified |

## Build & test results
```
$ npx vitest run .../composer-path-drop.test.ts     # 30 passed
$ npm run build:web-client / typecheck              # success
$ npm run lint                                      # no warnings in changed files
$ npx oxfmt <changed files>                         # clean
```
Manual, Chromium 150 only, mock dev daemon (:6790) + vite (:5180), scratch workspace `/tmp/ps081-ws`, real
CDP drag events (`Input.dispatchDragEvent`); one-event render lag of the hidden headless tab handled by
sending several dragovers per position:
- Insert at caret with smart spacing (`hello world` caret 6 -> `hello README.md world`, caret 16), from the
  textarea, the toolbar and the attachment strip. No tab opened, no pane split, outline 0 previews.
- Folder -> `src/ `; spaced name -> `` `my docs/note one.md` ``; selection `[0,5)` replaced, spacing judged
  outside it (`src/ README.md world`).
- Ctrl+Z once removed exactly the dropped text (`hello world`), redo restored it (real composer, execCommand path).
- `/co` + drop -> `/co README.md `, slash menu closed.
- Compacting (mock `/compact`, 1.5 s window): no outline, nothing inserted, nothing opened, 0 pane previews.
- Refusal (custom path-ref payloads through CDP): `/tmp/ps081-ws2/other.txt` (sibling prefix), `/etc/hosts`
  and the root `/tmp/ps081-ws/` each show "Not inside this workspace", draft unchanged; cleared by typing.
- Outline: on over card body/toolbar, off over a pane body and off over the tree, on again; cleared when the
  drag ended without a drop on the card, and on drop.
- Pane body -> composer: pane preview disappears (task-004).
- Drop into a non-focused split pane's composer moved the focused-pane marker to that pane.
- Regression: `+` attach (file input) still adds an attachment; a chat row over the composer still previews
  as a pane drop.

## Acceptance criteria
- [x] `decideComposerDrop` tests (ignore/compacting/refuse/inside/neverFocused)
- [x] Manual Chrome checklist, except the two items below
- [ ] NOT exercised live: a drop while a turn is RUNNING (the mock turn ends in ~5 ms, so the composer is never
      observably in the running/steer state; `Composer` has no running special-case, D10, by code review only)
- [ ] NOT exercised: image PASTE regression (code path untouched); a timeline file link released over the composer
      (carries no path-ref; covered by the `yieldsToComposer` unit test)
- [ ] Never-focused caret rule exercised only as a unit test + the spike (not reproduced in the real composer)

## Follow-ups / TODO(verify)
- Firefox/Safari run belongs to task-006 (not possible on this host).
