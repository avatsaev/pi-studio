# Task 001 — In-app session rename; `dialogs.prompt` leaves the host contract — Summary
- **Sprint:** sprints/sprint-104-desktop-dialogs-links-save
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
- The session menu's Rename now opens a workbench dialog built on the design-system `Dialog` and `TextInput`.
  - The title is pre-filled and selected.
  - Enter or the Rename button confirms. Escape, Cancel or a click outside dismisses.
  - Closing focuses the session's row. `SessionItem` gets `data-session-row` and `tabIndex={-1}`, so it can take focus from script without becoming a tab stop.
- `resolveRenameTitle(input, current)` is a pure function. It returns the trimmed title, or `null` for a blank, whitespace-only or unchanged input.
- `applySessionRename` replaces `renameSession`. It applies the title to the session store, the tab label and `agent.update`, as before.
- `prompt` is removed from `HostDialogs`, `browserDialogs` and the test host (including its `prompts` option).
- The guard test now forbids `window.prompt` and `dialogs.prompt`, and points both at the in-app dialog. Its messages now carry the full instead-text, with the `host.` prefix written into each value.
- A small `useSessionRenameStore` holds which session is being renamed.
- The dialog is mounted in `SessionList` next to `SessionContextMenu`, not in the shell. I chose this to avoid touching `TabPanelHost`, which a sibling task may own.

## Files created / changed
| File | Change |
|---|---|
| `features/sessions/rename-title.ts` (+ `.test.ts`) | new pure decision and its tests |
| `features/sessions/RenameSessionDialog.tsx` (+ `.module.css`) | new dialog |
| `stores/session-rename-store.ts` | new store |
| `features/sessions/session-actions.ts` | `renameSession` replaced by `applySessionRename`; header comment updated |
| `features/sessions/SessionContextMenu.tsx` | Rename opens the store and closes the menu |
| `features/sessions/SessionList.tsx` | mounts the dialog |
| `features/sessions/SessionItem.tsx` | `data-session-row` and `tabIndex={-1}` |
| `host/types.ts`, `host/browser-host.ts`, `test/test-host.ts` | `prompt` removed |
| `host/host-guard.test.ts`, `host/host-members.test.ts` | guard updated; rename test now covers `applySessionRename` |

All paths are under `packages/workbench/src/`.

## How it satisfies the scope
Every item in the task's "What to build" list is implemented as written. The only judgement call is the mount point, noted above.

## Build & test results
```
$ npx vitest run packages/workbench/src
Test Files  118 passed (118)   Tests  1504 passed (1504)
$ npm run build:workbench        -> check-dist: ok
$ npm run build:web-client       -> built in 12.01s
$ npx oxfmt <changed files>      -> run, no errors
$ npm run lint                   -> warnings only, none in files I touched
$ cd desktop/apps/pistudiodesktop && npm run check   -> tsc -b, no output (passes)
```
Nothing under `desktop/apps/pistudiodesktop/src` or `packages/web-client/src` referenced `dialogs.prompt`.

## Acceptance criteria
- [x] The pure function trims a changed input and returns nothing for a blank or unchanged one (unit tests).
- [x] No source file calls `dialogs.prompt`; the guard test would fail if one did (full workbench suite green).
- [x] `HostDialogs` has `confirm` and `alert` only; the package builds and its tests pass.
- [ ] Web-client behaviour (dialog shown with the title selected, Enter renames row and tab, Escape changes nothing, focus back on the row) — not checked. I skipped the browser check as instructed; the orchestrator does the live check.
- [ ] The README and AGENTS host rows no longer list `prompt` — not done. I may not edit those files; the proposed text is below.

## Follow-ups / TODO(verify)
- Live browser check: focus returning to the row. It relies on `data-session-row` and the dialog's `onCloseAutoFocus`.
- The row may show a focus ring after a programmatic focus.

## Proposed doc edits for the orchestrator
- `packages/workbench/README.md:135` — change the row to:
  `| \`dialogs.confirm/alert\` | Promises. Dismissal resolves \`false\` / nothing. Session rename is not a host dialog: the workbench draws its own \`RenameSessionDialog\`. |`
- `packages/workbench/AGENTS.md:33` — change `dialogs.confirm/alert/prompt` (promises; dismissal → `false`/`null`) to `dialogs.confirm/alert` (promises; dismissal → `false`). Add a note that no host provides a text prompt.
- `packages/workbench/AGENTS.md:68` — change `window.confirm/alert/prompt` to `window.confirm/alert`.
- `packages/workbench/AGENTS.md`, layout tree — add the new files:
  - `features/sessions/RenameSessionDialog.tsx` (+ `.module.css`): in-app rename dialog, opened by `useSessionRenameStore`.
  - `features/sessions/rename-title.ts`: pure `resolveRenameTitle`.
  - `stores/session-rename-store.ts`.
  - Also update the `session-actions.ts` entry: it now exports `applySessionRename` and `deleteWorkspaceConversations`.
- `packages/workbench/AGENTS.md`, host guard description — it forbids `window.prompt` and `dialogs.prompt`, pointing at the in-app rename dialog.

## Wave gate (orchestrator)
```
Wave gate: npm run build OK; npm run typecheck OK; npm run lint OK (exit 0); npm test 276 files / 3913 tests passed. Workbench doc edits applied by the orchestrator (AGENTS.md host section + file-link render layer, README host table).
```
