# Task 001 — Spike: `execCommand('insertText')` inside a native drop on the controlled composer

- **Sprint:** sprint-081-composer-path-drop
- **Status:** backlog
- **Type:** test
- **Area:** packages/web-client (features/chat)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Settle by experiment the three browser-behaviour unknowns the composer drop rests on, before task-005
builds on them.

## Context / why

D11 (native undo) assumes `document.execCommand("insertText")` works inside a native `drop` handler
on a React-controlled `<textarea>` whose value round-trips through `draft-store`. This is
deprecated-but-universal API behaviour, and the vitest env has no DOM, so only a real browser can
answer it. Two smaller spec TODOs ride on the same throwaway harness.

## Scope references

- swe/features/composer-path-drop.md § Behavior & algorithms › `onComposerDrop`, § TODO(verify) #2, #5
- swe/grills/drag-file-into-composer.md D11, D3
- packages/web-client/src/features/chat/Composer.tsx (`TextArea`, `handleTextareaChange`, `textareaRef`)
- packages/web-client/src/stores/draft-store.ts (`setDraft`)
- packages/web-client/src/features/files/FileExplorer.tsx (`handleDragStartRow`, for a temporary payload)

## What to build

Build a **temporary**, uncommitted (or reverted before close) wiring: a `drop` handler on the
composer card that, for a drag from a Files-tree row, focuses the textarea, calls
`setSelectionRange(start, end)`, then `execCommand("insertText", false, "<text>")`. Run it against
the dev stack (`npm run dev:daemon` + `npm run dev -w packages/web-client`) and record, for
**Chrome, Firefox and Safari**:

1. Whether `execCommand` returns `true` and the text is inserted at `[start, end)`.
2. Whether React's `onChange` fires, so the draft store holds the new value and the controlled
   value equals the DOM value with no re-overwrite or caret jump.
3. Whether one Ctrl/Cmd+Z removes exactly the inserted text, and a second undo reaches earlier
   typing.
4. Whether the `setRangeText(…, "end")` fallback, followed by a manual `setDraft`, leaves the
   textarea consistent. Record what happens to undo on that path.
5. **TODO(verify) #5.** What `selectionStart`/`selectionEnd` report on a never-focused textarea
   holding a non-empty draft (seed one via the draft store). Decide the rule. The spec recommends
   "never focused since mount → insert at end".
6. Whether the browser's **default** textarea drop (inserting `text/plain`) fires when the card's
   handler calls `preventDefault`. Tree rows set no `text/plain`, but confirm nothing doubles.

Write the findings to `swe/notes/composer-path-drop-spike.md`: a browser × question table, the
chosen fallback trigger (for example "`execCommand` returned false" versus "value unchanged after
the call"), and the never-focused rule.

## Out of scope

- Shipping any composer code (task-005)
- Pure helpers (task-002)

## Acceptance criteria

- [ ] `swe/notes/composer-path-drop-spike.md` answers questions 1–6 for Chrome, Firefox and
      Safari, or names any browser that could not be tested and why
- [ ] It states the fallback detection rule and the never-focused caret rule task-005 must implement
- [ ] The working tree carries no spike code at task close

## Test / verification plan

- Manual, per browser, on the dev stack as above; findings recorded in the note
- `git status` shows only the note added

## Notes

- If `execCommand` proves unusable in a browser, the fallback becomes the primary path there.
  Record the undo consequence; D11 then holds "where the platform allows", and the spec amendment
  lands in task-006.
