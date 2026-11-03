# Task 005 — Composer drop zone: affordance, insertion, refusal, focus

- **Sprint:** sprint-081-composer-path-drop
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (features/chat)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003, task-004

## Goal

Dropping a Files-tree row anywhere on the composer card inserts its formatted relative path at the
caret, with native undo, focus, and every state rule from the spec.

## Context / why

This is the user-visible feature. All text logic is in task-002, the payload in task-003, and pane
precedence in task-004. This task is wiring, plus one pure decision function so the branching stays
testable without a DOM.

## Scope references

- swe/features/composer-path-drop.md § Public contract 3, § Behavior & algorithms (`onComposerDrop`,
  Affordance, Root resolution), § Error handling & edge cases
- swe/grills/drag-file-into-composer.md D3, D4, D8–D12, D16–D18
- swe/notes/composer-path-drop-spike.md (task-001: fallback rule and never-focused caret rule)
- packages/web-client/src/features/chat/Composer.tsx (`.card`, `textareaRef`,
  `handleTextareaChange`, `pickError` / `styles.inlineError`, `compacting`)
- packages/web-client/src/features/chat/Composer.module.css (`.card:has(.textarea:focus)`,
  `.card.flash`, reduced-motion block, `.card.compacting`)
- packages/web-client/src/features/chat/ChatPanel.tsx (passes `owningPaneId`)
- packages/web-client/src/hooks/use-home-dir.ts, packages/web-client/src/stores/session-store.ts,
  packages/web-client/src/stores/layout-store.ts (`focusPane`)

## What to build

- **Pure decision** (in `composer-path-drop.ts`, tested):
  `decideComposerDrop({ refValue, compacting, root, text, selStart, selEnd, neverFocused }) →
  { kind: "ignore" } | { kind: "refuse" } | { kind: "insert", plan }`. It composes the task-002
  helpers. `neverFocused` applies task-001's caret rule.
- **Composer card** (`Composer.tsx`):
  - Spread the task-004 marker on `.card`.
  - `onDragEnter`/`onDragOver`: when `hasPathRef(types)` and not compacting, `preventDefault`, set
    `dropEffect = "copy"`, and set a `dragOver` flag (only on change).
  - `onDragLeave`: use the `relatedTarget` containment guard.
  - A document-level `dragend`/`drop` listener (effect with cleanup) clears the flag.
  - `onDrop`: run the decision.
    - `refuse`: show "Not inside this workspace" through the existing inline error line, which
      clears on the next edit (D17).
    - `insert`: focus the textarea, `setSelectionRange(start, end)`, then
      `execCommand("insertText")` per the spike. On fallback, `setRangeText` and call
      `handleTextareaChange`'s logic with the new value (extract it to a function taking a string
      if needed, so both paths share it: draft write, autosize, menu recompute, error clears). Put
      the caret at `plan.caret`.
    - Then `focusPane(workspaceCwd, owningPaneId)`. Thread `owningPaneId` from `ChatPanel` to
      `Composer` (spec TODO #3, default on).
  - Track `neverFocused` with a ref set on the textarea's first `focus`.
- **Root**: `refRoot(session.cwd, useHomeDir())`.
- **Affordance CSS**: `.card.dropTarget` reuses the `.card:has(.textarea:focus)` accent border, held
  without transition under `prefers-reduced-motion: reduce` like `.card.flash`. Never applied while
  compacting. No new element inside the card.

## Out of scope

- Cross-browser undo verification and docs (task-006)
- Other drag sources (deferred, D2)

## Acceptance criteria

- [ ] `decideComposerDrop` tests: no ref → ignore; compacting → ignore; root `null` or outside root →
      refuse; inside → insert with the expected plan (empty draft, selection, glued word, folder `/`,
      spaced path wrapped); `neverFocused` follows the spike rule
- [ ] Manual, Chrome, on the dev stack, covering spec acceptance:
  - insert at the caret with smart spacing, from textarea, toolbar and attachment strip alike; no
    tab opens and no pane splits
  - folder gets a trailing `/`; a spaced name gets backticks
  - a selection is replaced
  - one undo removes exactly the insertion
  - `/co` + drop gives `/co <path> ` and the menu closes
  - compacting: no outline, no insert, no pane action
  - a running turn inserts normally
  - outside-root refusal notice, cleared on typing
  - the outline clears on leave, Escape and drop; moving pane body → composer removes the pane
    preview
  - dropping into an unfocused split pane's composer focuses that pane
- [ ] Regression: a chat row or timeline file link released over the composer is still a pane drop;
      image paste and `+` attach still work

## Test / verification plan

- `npx vitest run packages/web-client/src/features/chat/composer-path-drop.test.ts`
- `npm run build:web-client`, `npm run typecheck`, `npm run lint`; `npx oxfmt` on changed files
- Manual checklist above on `npm run dev:daemon` + `npm run dev -w packages/web-client`, with
  screenshots of the affordance and of a refusal

## Notes

- Keep `.textarea`'s 1px transparent border and the highlight mirror untouched. The affordance
  styles `.card` only (web-client AGENTS.md "Composer layout").
- Never log path text.
