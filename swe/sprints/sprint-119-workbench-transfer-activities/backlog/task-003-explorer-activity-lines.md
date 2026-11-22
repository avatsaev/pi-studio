# Task 003 — Explorer: the activity lines with Cancel; the other save triggers stay silent on a cancel

- **Sprint:** sprint-119-workbench-transfer-activities
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench/src/features/files
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
The Files explorer draws one line per activity with a Cancel button, in both clients.

## Context / why
The line for uploads exists (`status`); saves show nothing in the explorer. The row menu alerts on a failed save, the viewers' button shows a spinner and an error.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 7, decisions D8, D11, S8
- `packages/workbench/src/features/files/FileExplorer.tsx` (the `status` state and where it is drawn), `FileExplorer.module.css` (`.status`, `.statusError`), `FileContextMenu.tsx` (`download`), `SaveFileButton.tsx`, `PdfViewer.tsx` (its `saveToDisk` call)
- `packages/ui-library` (the button primitive and the tokens)

## What to build
- Where the status line is: one line per activity, oldest first, at most four, then `and N more`. Each line: its text (ellipsized) and a Cancel button whose accessible name is `Cancel: <the line's label>`.
- The explorer's one transient status line stays for results (and for move, create, rename as today), fed by the store's last result.
- `FileContextMenu` no longer alerts for an `AbortError`; `SaveFileButton` and `PdfViewer` show no error for one. Their other feedback is unchanged.
- Styles: tokens only, `rem`, no fallback values; the button resets background, border and cursor.

## Out of scope
- Any change to the viewers beyond the cancel case.

## Acceptance criteria
- [ ] Given two saves and a batch running, then three lines are drawn, each with its own Cancel, and a line's DOM changes only when its text does.
- [ ] Given six activities, then four lines and `and 2 more`.
- [ ] Given a save cancelled from its line, then the row menu shows no alert and the viewer's button no error.
- [ ] The style tests (no literal font size, valid tokens) pass.

## Test / verification plan
- `npx vitest run packages/workbench`
- `npm run build`; `npm run typecheck`; `npm run lint`; `npx oxfmt <changed files>`
- `(cd desktop/apps/pistudiodesktop && npm run snapshot)`: no CSP violation; look at the image

## Notes
- Rendering is checked live in task-004; here, keep the text and the cap in the pure function of task-002 and test them there.
