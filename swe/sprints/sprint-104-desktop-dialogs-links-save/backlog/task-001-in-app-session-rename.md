# Task 001 — Workbench: in-app session rename; `dialogs.prompt` leaves the host contract

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (features/sessions, host)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Renaming a session opens a dialog drawn by the workbench, in the web client and the desktop app alike, and no host has to provide a text prompt.

## Context / why
D9. Session rename is the only caller of `host.dialogs.prompt`, and the browser host answers it with `window.prompt`. A native shell has no text prompt to offer, so the member goes and the one caller gets a proper dialog.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 3 (`HostDialogs`), § Public contract 4 (row "Session rename")
- `swe/architecture/workbench-host-adapter.md` § Amendment (row `dialogs.prompt`)
- `packages/workbench/src/features/sessions/session-actions.ts` (`renameSession`), `SessionContextMenu.tsx` (its caller)
- `packages/workbench/src/host/types.ts` (`HostDialogs`), `host/browser-host.ts` (`browserDialogs`), `host/host-guard.test.ts` (`FORBIDDEN`), `host/host-members.test.ts`, `test/test-host.ts` (`prompts`)
- `packages/ui-library/src/primitives/Dialog.tsx`, `TextInput.tsx`
- `packages/workbench/README.md` § The host, `packages/workbench/AGENTS.md` (host member list)

## What to build
- A rename dialog built on the design system's `Dialog` and `TextInput`, mounted once in the shell and opened for a session by a small store. One text field, pre-filled with the current title and selected.
  - Enter or the Rename button confirms; Escape, Cancel or a click outside dismisses.
  - A dismissed, blank or unchanged answer changes nothing. Otherwise the title is trimmed and applied exactly as today (session store, tab label, `agent.update` when the session has an agent).
  - Focus returns to where it was.
- The decision "what title, if any, does this input produce" is a pure function with tests.
- Remove `prompt` from `HostDialogs`, the browser host and the test host. The guard test forbids `dialogs.prompt` and points `window.prompt` at the in-app dialog.
- Update the host rows in the package README and AGENTS file.

## Out of scope
- Confirm and alert: unchanged, still host calls.
- The desktop host's native dialogs (task-004, task-006).

## Acceptance criteria
- [ ] The pure function returns the trimmed title for a changed input and nothing for a blank, whitespace-only or unchanged one.
- [ ] No source file under `packages/workbench/src` calls `dialogs.prompt`, and the guard test fails if one does.
- [ ] `HostDialogs` has `confirm` and `alert` only; the package builds and its tests pass.
- [ ] In the web client: rename from the session menu shows the dialog with the title selected; Enter renames the row and the tab; Escape changes nothing; focus is back on the row.
- [ ] The README and AGENTS host rows no longer list `prompt`.

## Test / verification plan
- `npx vitest run packages/workbench/src/host packages/workbench/src/features/sessions`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- Browser: `npm run dev:daemon` on a free port, the web client's dev server, rename a mock session.

## Notes
- Shared documents: in a parallel wave do not edit `packages/workbench/AGENTS.md` or `README.md`; put the exact edits in the summary (task-002 touches the same files).
- This is the one visible change for web-client users in this sprint besides external links.
