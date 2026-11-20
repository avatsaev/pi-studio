# Task 004 — Workbench: adding and editing a daemon entry

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/daemons)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
From the Daemons screen a person can add a direct or a relay entry and edit any entry, with every refusal explained in the form, and without a stored secret ever being displayed.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 4 (row "Edit form"), § Public contract 1 (rules table), § Adding, editing, removing, § Error handling ("a name already in use, an empty name, a malformed address or link, a 65th entry")
- `swe/grills/desktop-native-shell.md` D13, D23, D24
- `packages/workbench/src/features/daemons/` (the screen: task-003; the error messages: task-001)
- `packages/workbench/src/lib/connection/resolve-connect-target.ts` (`resolveConnectTarget`: tells a pairing link from an address), `src/features/connection/connection-presentation.ts` (`isDialableTarget`)
- `packages/ui-library` (`TextInput`, `Select`, `Button`)

## What to build
- **Add:** a choice of kind, then
  - direct: name, address, optional password;
  - relay: name, pairing link.
  A new entry is not opened automatically; the list shows it.
- **Edit:**
  - local: name, password;
  - direct: name, address, password;
  - relay: name, and a "Replace link" field that is empty.
  **A stored secret is never put in a field.** The password field is empty with a "saved" marker when one exists; leaving it empty keeps the password; a Clear action removes it (`password: null`). An empty "Replace link" keeps the link.
- **Checks in the form, before the host is called**, with the existing parsers: the address must be dialable and must not be a pairing link; the pairing link must parse as one; the name is not blank. Sizes, uniqueness and the entry count are checked by the host, and its error code is shown next to the field it concerns (`name_taken` and `invalid_name` at the name, `invalid_address` at the address, `invalid_link` at the link, `too_many` at the form).
- **Only what changed is sent** on edit: an untouched field is absent from the patch.
- **Editing the current entry:** after a saved change of address, password or link, the screen offers "Reconnect now" (the shared action of task-001). Nothing reconnects by itself.
- The form's logic (what to validate, the patch to send, where an error code lands) is a pure module with tests.

## Out of scope
- Remove (task-003). The `wrong_key` marker that leads a person to "Replace link" (task-005).

## Acceptance criteria
- [ ] Add direct with a blank name, an address that is a pairing link, or an undialable address is stopped in the form with the matching message, and the host is not called.
- [ ] Add relay with text that is not a pairing link is stopped the same way.
- [ ] The host's `name_taken` is shown at the name field and the form stays open with its content.
- [ ] Editing only the name of a direct entry with a password sends a patch with `name` and nothing else; the password is still there afterwards.
- [ ] Clear sends `password: null`; typing a new password sends it; an empty field sends no `password`.
- [ ] Editing a relay entry with a new link sends `pairingLink` and keeps the name; an empty field sends none.
- [ ] No test or code path reads a secret from the snapshot (it has none), and the edit form's initial values never contain one.
- [ ] After changing the current entry's address, "Reconnect now" is offered; for another entry it is not.
- [ ] `npm run build:workbench` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- Forms are driven in the desktop webview in task-007.

## Notes
- The address is stored as typed and normalised when connecting, as the connection bar does today: the form validates and does not rewrite it.
- Password and link fields use the input type that hides the text; values are never logged and are cleared from component state when the form closes.
