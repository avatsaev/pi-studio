# Task 006 — Desktop host: `files` through the engine (§ 6) — Summary

- **Sprint:** sprints/sprint-122-desktop-transfer-wiring
- **Completed:** 2026-11-22
- **Status:** done

## What was implemented
The desktop host now builds its `files` once, from `snapshot.transfers` and the current entry's kind.
- **Engine on, entry `local` or `direct`:** the host uses the engine's files. `pickUploads` calls `upload_pick`, and each returned source is `{name, size?}` with its handle kept out of sight.
- **Uploads and saves:**
  - A picked source uploads through `transfer_upload {id, handle, path}`, with `path` = `<dir>/<name>`.
  - A `Blob` goes to the browser host's `upload`.
  - `saveToDisk` calls `save_begin` first. A `null` answer resolves with no further command. Otherwise it calls `transfer_save`.
- **Progress and cancel:**
  - One `transfer_progress` listener serves the whole host. It is registered when the host is built.
  - Events go by `id` to `onStateChange` and `onProgress`. `onStateChange` fires only when the state changes. `onProgress` fires only for `running` events, so a stale `done` on `waiting` never reaches the workbench.
  - An abort calls `transfer_cancel {id}` once. The abort listener is removed when the transfer settles.
- **Errors:** an error with code `cancelled` becomes a `DOMException` named `AbortError`. Any other `{code, message}` becomes an `Error` with its message. A string or an `Error` is passed on as is.
- **Otherwise:** `files` is exactly `base.files`, with no `pickUploads`.
- **Counting:** `countTransfers` still wraps whichever `files` was chosen.

## Files created / changed
| File | Change |
|------|--------|
| `desktop/apps/pistudiodesktop/src/host/transfers.ts` | modified: `beginSave` (shared with `createSaveTarget`), `engineServes`, `createEngineFiles` |
| `desktop/apps/pistudiodesktop/src/host/desktop-host.ts` | modified: chooses engine or browser `files` once, then wraps with `countTransfers`; imports re-ordered |
| `desktop/apps/pistudiodesktop/src/host/transfers.test.ts` | added tests (`engineServes`, engine files with a fake `ipc`) |
| `desktop/apps/pistudiodesktop/src/host/desktop-host.test.ts` | created: relay and `page` cases, and the engine case |

## How it satisfies the scope
- It follows spec § 2 (commands and event), § 6 (table) and "The desktop host's choice".
- **Error shape:** a Tauri `invoke` rejects with whatever the command's `Err` serialized to. The existing hosts see plain strings. The engine's errors are `{code, message}` objects (spec § Error handling), so `transferFailure` reads that shape first.
- **Handles:** they live in a module-level `WeakMap`, so they are not on the source object and do not show in `JSON.stringify` or in `Object.keys`.
- **Added beyond the pseudocode:**
  - A signal already aborted when a transfer starts rejects with `AbortError` before any command runs.
  - A signal that aborts during the save dialog calls `save_discard {handle}` and starts no transfer.
  - A transfer awaits listener registration first, so no event is lost. If registration failed, the error is logged and the transfer rejects with it.
- Only `ipc.ts` imports the Tauri API. Lint passes.
- **Docs:** the task lists none. `desktop/docs/architecture.md` is not changed (it only describes the `save_begin` row).
- **Formatting:** the repo's `.oxfmtrc.json` ignores `desktop/**`. I formatted my four files with a temporary `printWidth: 120` config, which matches the existing files, then deleted the config.

## Build & test results
```
$ (cd desktop/apps/pistudiodesktop && npm run check)   # tsc -b
success

$ npm run lint   # oxlint --type-aware --deny-warnings
success, no findings

$ npm test       # vitest run
Test Files 25 passed (25); Tests 224 passed (224)
```

## Acceptance criteria
- [x] A picked source uploads through `transfer_upload` with `path` = `<dir>/<name>`; a `Blob` goes to the browser host's upload; a save goes `save_begin` then `transfer_save`; a cancelled dialog resolves without `transfer_save`. (engine files tests)
- [x] Events for another `id` are ignored; an abort calls `transfer_cancel` once; `cancelled` rejects with an error named `AbortError`. (dispatch and abort tests)
- [x] For a relay entry, and with `transfers: "page"`, the host has no `pickUploads` and no engine command or progress listener is used. (`desktop-host.test.ts`)
- [x] The lint rule still holds: only `ipc.ts` imports the Tauri API. (`npm run lint`)

## Follow-ups / TODO(verify)
- Real Rust behavior is not exercised: tests use a fake `ipc`. The `{code, message}` error shape and the `transfer_progress` payload follow spec § 2, and task-005 (the Rust commands) must match them.
- A cancel that races the command arriving in Rust returns `{cancelled: false}` and the transfer continues. This is a narrow window and the contract has no way to close it.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
```
