# Task 005 — Frontend: the `daemons` member of the desktop host — Summary

**Sprint:** sprint-109-desktop-registry-wiring · **Completed:** 2026-11-20 · **Status:** done. All acceptance criteria pass.

## What was implemented
- **Snapshot validation.** `parseBootSnapshot` now requires `app.minDaemonVersion` (a non-empty string) and `daemons` `{currentId, entries, local, settings}`. A snapshot without them returns `null`, so boot fails like any malformed snapshot. The parser for the view and the local state lives in `daemons-view.ts`. It is tolerant of an absent or `null` `address` or `path`.
- **`createDesktopDaemons` in `daemons.ts`.**
  - `snapshot()` returns the held view synchronously.
  - A `daemons_changed` event replaces the view first, then notifies subscribers once each. A malformed payload is logged and ignored. A listener that throws does not stop the others.
  - `add`, `update`, `remove`, `local.*` and `setSettings` call `engine_command`. `settings.set` takes one `{key, value}` per call, so `setSettings` writes each given key in turn.
  - `local.*` resolve once the command is accepted.
  - An error text that is one of the 18 `DaemonErrorCode`s rejects with `HostDaemonError`, which carries `code` and `name = "DaemonError"`. Any other failure stays a plain `Error`. `invalid_password` is not in the workbench's code union, so it comes out as a plain error.
  - `resolveCurrent()` returns the `daemon_resolve_current` answer unchanged, maps codes the same way, and logs nothing of the intent.
  - `switchTo(id)` awaits `storage.settled()`, then calls `daemon_switch`. `"cancelled"` resolves, an error rejects, and success leaves the promise pending.
  - `onManageRequest` fires on `daemons_manage`.
- **Resync after the listener registers (not in the task text).** Once the `daemons_changed` listener is in place, the host reads `daemon.list` and `settings.get` once. It replaces the view and notifies only if the result differs from the held view. It does nothing if an event arrived meanwhile. This closes the gap where the local daemon's first probe could land between the boot snapshot and listener registration, which would leave the UI stuck on "checking".
- **`ipc.ts`** stays the only Tauri importer. It adds the `IpcEvents.listen` interface and `tauriIpc: Ipc & IpcEvents`, which passes each event's payload through to the handler. The existing `Ipc` is unchanged, so the other fakes are untouched.
- **`desktop-host.ts`** adds `daemons: createDesktopDaemons(snapshot.daemons, ipc, () => storage.settled(), log)` and takes `ipc: Ipc & IpcEvents`.
- **Browser host.** `main.tsx` is untouched, so the browser path has no `daemons` and `npm run snapshot` still draws the workbench.

## Files
- **New:** `src/host/daemons-view.ts`, `src/host/daemons.ts`, `src/host/daemons.test.ts`.
- **Edited:** `src/host/boot.ts`, `src/host/boot.test.ts`, `src/host/ipc.ts`, `src/host/desktop-host.ts`.
- `isRecord` moved from `boot.ts` into `daemons-view.ts` and is exported.
- `package.json` is unchanged.

## Build & test results
- `npm run check`, `npm run lint` and `npm test` pass: 60 tests in 7 files. The new `daemons.test.ts` covers every method plus the resync cases, and `boot.test.ts` gained rows for the new snapshot fields.
- `npm run build && npm run snapshot -- --out /tmp/ui-t005.png` wrote the image; I did not open it.
- `cargo xtask ci` passes all 8 steps (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm); 272 Rust tests passed.
- `oxfmt` skips `desktop/` (the root config ignores it), so formatting was not checked on these files.

## Acceptance criteria
- [x] `snapshot()` returns the boot view; after a fake `daemons_changed` it returns the new view, each subscriber is called once, and an unsubscribed one is not.
- [x] `add` rejecting with `name_taken` yields a `DaemonError` with that code; a transport failure yields a plain error.
- [x] `switchTo` does not call `daemon_switch` until a pending `storage_set` has been answered.
- [x] `switchTo` resolves on `cancelled`, rejects on `not_found`, and stays pending on success.
- [x] `resolveCurrent` returns the intent unchanged (same object), and rejects with `local_stopped` as a `DaemonError`.
- [x] Outside Tauri the browser host is used and has no `daemons`.
- [x] `npm run check`, `npm run lint`, `npm test` and `cargo xtask web` pass.

## Follow-ups / TODO(verify)
- Not exercised against a real Tauri webview: the event payload shape (`listen` handing over `message.payload`) and Tauri's handling of an `engine_command` call with no `params` key. Both follow the Rust code and docs, but only the fakes ran.
- `daemons_manage` is assumed to carry no payload.
- An event emitted before `listen` resolves is lost. Only `daemons_changed` is covered by the resync; a `daemons_manage` in that window is not.

## Proposed doc edits
- **`desktop/apps/pistudiodesktop/AGENTS.md`, host source layout:** add `daemons.ts` (the `HostDaemons` member: view held in memory, `engine_command` and `daemon_*` calls, error-code mapping, resync after listening), `daemons-view.ts` (the view type and its parser, shared with the boot snapshot), and `IpcEvents.listen` in `ipc.ts`.
- **Same file, invariants:** the boot snapshot now requires `app.minDaemonVersion` and `daemons`, and `ipc.ts` also owns the event listener.
- **`swe/features/desktop-daemon-registry.md` § 3:** the `HostDaemons` listing lacks `setSettings`, `settings` in `snapshot()` and `DaemonSettings` (decision P3). The page re-reads the registry once after registering its listener.

## Wave gate (orchestrator)
```
Orchestrator: cargo xtask ci (8 steps) passed.
```
