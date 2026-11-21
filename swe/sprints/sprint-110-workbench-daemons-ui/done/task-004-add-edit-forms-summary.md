# Task 004 — Add/edit forms — Summary

- **Sprint:** sprint-110-workbench-daemons-ui
- **Completed:** 2026-11-20
- **Status:** done. The workbench build and web-client build pass, and the daemons tests and oxlint are clean. The forms have not been driven in a browser or the desktop webview; that is for task-007.

## What was implemented
- **Add and Edit buttons:** the Add and Edit buttons in `DaemonsScreen.tsx` are enabled. Either one swaps the list and settings for `DaemonForm`.
- **Add form:**
  - It starts with a kind choice (Address or Relay).
  - Direct takes a name, an address and an optional password.
  - Relay takes a name and a pairing link.
  - A new entry is added but not opened.
- **Edit form:**
  - Local takes a name and a password.
  - Direct takes a name, an address and a password.
  - Relay takes a name and an empty "Replace link" field.
  - The edit form never reads a secret. The password field starts empty.
  - The password field carries a "Saved" marker and a Clear button, which turns into "Will be removed" with a Keep button.
  - Password and link fields use `type="password"`.
- **Checks before the host is called:**
  - A blank name is stopped.
  - A blank, undialable or pairing-link address is stopped.
  - A blank or non-pairing-link relay link is stopped.
- **Host refusals:** `name_taken` and `invalid_name` show at the name field, `invalid_address` at the address, `invalid_link` at the link, and everything else (including `too_many`) at the form. The form stays open with what was typed.
- **Patch on edit:** only changed fields are sent.
  - A typed password wins over a pending Clear.
  - An empty password field sends nothing; Clear sends `password: null`.
  - An empty link sends nothing.
  - An unchanged form makes no host call.
- **Reconnect:** a saved edit of the current entry's address, password or link shows "Saved. Reconnect to use the change." with a "Reconnect now" button that calls `useDaemonsStore.getState().connectCurrent()`. A rename, or an edit to another entry, offers nothing.
- **Closing:** the form unmounts on Cancel, a save or closing the dialog, so typed values are dropped. The reconnect offer clears when the dialog closes or another form opens.

## Files
| File | Change |
|---|---|
| `features/daemons/daemon-form.ts` | new: pure module for field visibility, validation, new entry, patch, error placement and reconnect rule |
| `features/daemons/daemon-form-actions.ts` | new: `submitAdd` and `submitEdit` over `HostDaemons` |
| `features/daemons/daemon-form.test.ts` | new: 43 tests |
| `features/daemons/DaemonForm.tsx` | new: form component |
| `features/daemons/DaemonsScreen.tsx` | changed: enabled buttons, form swap, reconnect offer |
| `features/daemons/DaemonsScreen.module.css` | changed: form styles only |

I did not touch the store, `connect-current`, `use-daemons` or `daemon-presentation`.

## Build and test results
- **Tests:** `npx vitest run packages/workbench/src/features/daemons` passes, 114 tests across 6 files.
- **Builds:** `npm run build:workbench` and `npm run build:web-client` both pass. `npx tsc -b packages/workbench` is clean.
- **Format and lint:** `npx oxfmt` ran on the changed files and `npx oxlint features/daemons` is clean. I did not run the root `npm run lint`.

## Acceptance criteria
- [x] Add direct with a blank name, a pairing-link address or an undialable address is stopped in the form, and the host is not called. Verified by `buildNewDaemon` tests and the `submitAdd` "does not call the host" test (spied `add`, 0 calls).
- [x] Add relay with non-link text is stopped the same way. Verified by `buildNewDaemon` tests.
- [x] `name_taken` shows at the name field and the form stays open. Verified by the `submitAdd` and `submitEdit` `name_taken` tests; the component keeps its state on refusal.
- [x] Renaming a direct entry that has a password sends `{ name }` only and the password survives. Verified by the spied `update` test, which also checks `resolveCurrent().password` is still `"pw"`.
- [x] Clear sends `password: null`, a typed password is sent, and an empty field sends none. Verified by `buildPatch` tests.
- [x] A new relay link sends `pairingLink` only (name kept); an empty field sends none. Verified by `buildPatch` and `submitEdit` tests.
- [x] No path reads a secret: `DaemonEntryView` has none and `initialEditFields` leaves password and link empty. A test checks the initial fields for local, direct and relay entries against the stored secrets.
- [x] "Reconnect now" is offered after an address change on the current entry, and after a password change on the current local entry, but not for another entry or a rename. Verified by `submitEdit` and `needsReconnect` tests.
- [x] Workbench build and tests pass.

## Follow-ups
- Drive the forms and the reconnect flow in the webview in task-007.
- The edit form calls `connectCurrent()` straight through the store, which is the same action as Retry and boot. `invalidLinks` is not touched here (task-005 owns the `wrong_key` marker).
- Replacing a relay link does not call `clearLinkInvalid`, because the marker belongs to task-005. Task-005 may want to clear it on a saved `pairingLink` change.

## Proposed doc edits
**`packages/workbench/AGENTS.md`**, in the features/daemons listing, add:
```
daemon-form.ts (pure: add/edit form decisions — `formView` (which fields), `buildNewDaemon` / `buildPatch` (checks with `parsePairingUrl` + `isDialableTarget`; only changed fields in the patch; typed password beats Clear), `refusalErrors` (host code → field: name_taken/invalid_name → name, invalid_address → address, invalid_link → link, rest → form), `needsReconnect`; never a stored secret) (+ test),
daemon-form-actions.ts (`submitAdd` / `submitEdit` over `HostDaemons`, no throw; no host call when the form or an empty patch decides) ,
DaemonForm.tsx (add/edit form; swaps the list inside DaemonsScreen; values in component state only; password/link fields are `type="password"`).
```
Also change the DaemonsScreen line to say that Add/Edit open `DaemonForm` and that "Reconnect now" is offered after a saved change to the current entry's address, password or link.

**`packages/workbench/README.md`**: if the Daemons screen is listed, change "add/edit forms land with task-004" to "add and edit entries from the Daemons screen; a stored password or link is never shown".

## Wave gate (orchestrator)
```
Wave gate (t004+t006): npx vitest run packages/workbench 132 files / 1687 tests passed; build:workbench OK; build:web-client OK; oxlint clean on features/daemons and the new connection files. AGENTS layout updated by the orchestrator.
```
