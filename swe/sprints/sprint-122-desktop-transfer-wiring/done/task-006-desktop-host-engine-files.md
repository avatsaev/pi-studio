# Task 006 — Desktop host: `files` through the engine (§ 6)

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-119/task-001

## Goal
For a local or direct entry with the engine on, the Upload button opens the native picker and uploads and saves call Rust; otherwise the host behaves as today.

## Context / why
R1: the choice is fixed for the life of a page, so the host decides once, when it is built.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 6 (the table, "The engine serves"), § The desktop host's choice (pseudocode), § 2 (the commands and the event)
- `desktop/apps/pistudiodesktop/src/host/transfers.ts` (`createSaveTarget`, `countTransfers`), `desktop-host.ts`, `ipc.ts` (`invoke`, `listen`), `daemons.ts` (the current entry's kind), `boot.ts`, `transfers.test.ts`
- `packages/workbench/src/host/types.ts` (`TransferOptions`, `UploadSource`)

## What to build
- The engine serves when `boot.transfers` is `engine` and the current entry's kind is `local` or `direct`. Then: `pickUploads` calls `upload_pick` and returns sources that keep their handle out of the workbench's sight; `upload` of such a source calls `transfer_upload`, of a `Blob` the browser host's; `saveToDisk` calls `save_begin` (a `null` answer resolves: the user cancelled) and then `transfer_save`.
- A transfer: a new random `id`; one listener on `transfer_progress` for the host, dispatching by `id` to `onStateChange` and `onProgress`; `signal` aborting calls `transfer_cancel`; the command's error `cancelled` becomes an `AbortError`, any other an `Error` with its `message`.
- When the engine does not serve, `files` is exactly the browser host's (with the `saveTarget`), without `pickUploads`.
- `countTransfers` still wraps the result, so `transfers_set` counts engine transfers too.

## Out of scope
- Any change in `packages/workbench`.
- Reading a file's bytes in the page for a picked source.

## Acceptance criteria
- [ ] With a fake `ipc`: a picked source uploads through `transfer_upload` with `path` = `<dir>/<name>`; a `Blob` goes to the browser host's upload; a save goes through `save_begin` then `transfer_save`; a cancelled dialog resolves without `transfer_save`.
- [ ] Events for another `id` are ignored; an abort calls `transfer_cancel` once; `cancelled` rejects with an error named `AbortError`.
- [ ] For a relay entry, and with `transfers: "page"`, the host has no `pickUploads` and no engine command is called.
- [ ] The package's lint rule still holds: only `ipc.ts` imports the Tauri API.

## Test / verification plan
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)`
- `npx oxfmt <changed files>`

## Notes
- Built against a fake `ipc`, so it can run beside task-005.
