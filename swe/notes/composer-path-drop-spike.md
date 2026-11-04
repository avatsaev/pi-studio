# Spike — `execCommand('insertText')` on a drop into the controlled composer textarea

Sprint-081 / task-001. Settles the browser-behaviour unknowns `swe/features/composer-path-drop.md`
(`onComposerDrop`, TODO(verify) #2 and #5) rests on.

## Method

A throwaway harness (outside the repo, `/tmp/spike`, removed afterwards) reproduced the composer's
data flow with real React 19.2.7 and zustand from the repo's `node_modules`:

- a `<textarea value={draft} onChange={e => setDraft(e.target.value)}>` whose value round-trips
  through a zustand store, as `Composer.tsx` ↔ `draft-store.ts` does;
- a `drop` handler on a card (textarea + toolbar) that, for a drag carrying the path-ref MIME,
  does `focus` → `setSelectionRange(start, end)` → `execCommand("insertText")` (mode `exec`) or
  `setRangeText(…, "end")` + `setDraft(el.value)` (mode `range`);
- a draggable row carrying `application/x-pi-studio-move` and `application/x-pi-studio-path-ref`
  and **no** `text/plain`, like a Files-tree row.

The harness was driven with **real** CDP drag events (`Input.dispatchDragEvent` through
Puppeteer's drag interception) and real keystrokes, so native default drop behaviour and the
browser's undo stack were exercised. It deviates from the task's literal wording (dev stack with
temporary wiring in the real `Composer`) because the answers depend only on the browser, React's
controlled textarea and the store round-trip; the real composer is verified on the dev stack in
task-005. The harness omits the highlight mirror and `autoResize`, neither of which touches
the textarea's value or its undo history.

Browsers: **Chromium 150 only**. Firefox and Safari could not be tested on this host (no Firefox
or WebKit binary installed; the available browser tooling is Chromium-only). Task-006 owns the
Firefox/Safari run; the table marks them *untested*.

## Results

| # | Question | Chrome (Chromium 150) | Firefox | Safari |
|---|----------|-----------------------|---------|--------|
| 1 | `execCommand` returns `true` and inserts at `[start, end)` | Yes. `"hello world"` with caret at 6 + `"src/a.ts "` → `"hello src/a.ts world"`; a selection `[0,5)` is replaced (`"X  world"`) | untested | untested |
| 2 | React `onChange` fires; store equals DOM; no re-overwrite or caret jump | Yes. One `input` (`insertText`) → one `onChange`; store equals `el.value` immediately and 50 ms later. Caret lands at `start + insert.length` (15), no jump | untested | untested |
| 3 | One undo removes exactly the insertion; a second reaches earlier typing | Yes. Undo 1 → `"hello world"`; undo 2 → `"hello worl"` (earlier typing, in the store too); redo restores. For the replaced selection one undo restores `"hello world"` | untested | untested |
| 4 | `setRangeText(…, "end")` + manual `setDraft` stays consistent; undo | Consistent: DOM, store and caret (15) agree. **Undo is dead**: Ctrl+Z neither removes the insertion nor reaches earlier typing (the programmatic value write drops the whole undo history, including keystrokes typed before the drop) | untested | untested |
| 5 | `selectionStart/End` on a never-focused textarea with a non-empty draft | A textarea **mounted** with a non-empty controlled value reports `0/0` (`activeElement` is `BODY`). A drop with that caret inserted at the **start** (`"p/a.ts seeded draft"`). A draft set after mount reports end-of-text. Behaviour differs by mount path, so it cannot be trusted | untested | untested |
| 6 | Browser default textarea drop (`text/plain`) fires when the card handler calls `preventDefault` | No doubling. Dropping on the textarea itself and on the toolbar both insert exactly once. Rows carry no `text/plain` | untested | untested |

## Decisions for task-005

1. **Primary path:** `execCommand("insertText", false, insert)` after `focus()` and
   `setSelectionRange(start, end)`. It works in Chromium with the controlled value, and it is the
   only path that keeps native undo.
2. **Fallback trigger:** fall back when `execCommand` returns `false` **or throws**, **or** when
   the textarea value is unchanged after the call while `insert` is non-empty. Return value alone is
   not enough. Mid-spike, a call whose text argument was `undefined` returned `true` and changed
   nothing, so "value unchanged" is the real success check. Fallback is `setRangeText(insert, start,
   end, "end")` then the composer's shared change function with `el.value`, which writes the draft,
   autosizes, recomputes the menu and clears errors.
3. **Undo on fallback:** the whole undo history is lost, not only the insertion. D11 holds "where
   the platform allows"; the fallback is a last resort and its consequence belongs in the docs
   (task-006).
4. **Never-focused rule:** keep the spec's recommendation. If the textarea has not received focus
   since the composer mounted, insert at **end of text** and ignore `selectionStart/End`. Chromium
   reports `0/0` for a textarea mounted with a non-empty draft. After the first focus the live
   selection is trusted (selection survives blur).
5. **Default drop:** with `preventDefault` in the card handler nothing doubles, so no extra
   `text/plain` suppression is needed. Do not add `text/plain` to a row's payload.

## Open

- Firefox and Safari: every row above is untested. Task-006 must run questions 1–4 there and may
  need to amend D11 if `execCommand` misbehaves.
