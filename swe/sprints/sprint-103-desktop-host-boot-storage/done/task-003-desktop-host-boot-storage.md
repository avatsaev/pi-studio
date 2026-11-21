# Task 003 — Frontend: the desktop host (boot, storage), host selection, boot error, notices

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Inside the app window the workbench is mounted with a desktop host whose storage is backed by Rust; outside it (the snapshot tool, a plain browser on the dev server) the page still works with the browser host.

## Context / why
`main.tsx` mounts the workbench with `createBrowserHost()`, so settings live in the webview's storage. The workbench reads storage during its first render, so the stored keys must be in the page before React renders.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 1, § Public contract 2 (rows `app`, `storage`, `launch`), § Storage, § Files that cannot be read (notices), § Error handling (boot row)
- `desktop/apps/pistudiodesktop/src/main.tsx`, `.oxlintrc.json` (bans `@tauri-apps/**` and the browser storage/network globals), `package.json`, `vite.config.ts` (`test.include`)
- `desktop/apps/pistudiodesktop/scripts/snapshot.mjs` (serves `dist/` in Chromium: no Tauri there)
- `packages/workbench/src/host/types.ts` (`WorkbenchHost`, `KeyValueStore` rule: synchronous, never throws), `packages/workbench/src/host/browser-host.ts`
- `packages/ui-library` (`useToastStore`)

## What to build
- `src/host/ipc.ts`: the only module that imports `@tauri-apps/api`. The lint rule allows the import there and nowhere else.
- **Host selection, once at start:** Tauri present: desktop host. Tauri absent: the browser host, exactly as today.
- **Desktop host:** start from `createBrowserHost({ app, pdf })` and replace:
  - `app`: from the boot snapshot (`platform: "desktop"`);
  - `storage`: `get` reads an in-memory map filled from the snapshot; `set` updates the map and sends `storage_set` without waiting. A rejected send is logged and never thrown;
  - `launch`: no connect intent and no deep-link source.
- **Boot:** call `boot`, then render. If the call fails or the answer is not the expected shape, render a plain error (the reason and a Retry button) instead of the workbench.
- **Notices:** each `file_reset` notice becomes one non-blocking message after mount: "`<file>` could not be read and was reset. The old file was kept as `<keptAs>`."
- Keep decisions in pure functions with unit tests (the storage adapter over a fake `ipc`, snapshot validation, host selection, notice text). This package has no DOM test environment.

## Out of scope
- `dialogs`, `links`, `files.saveToDisk` (sprint-104), `preview` (sprint-105), `daemons` (registry plan): those members stay the browser host's.

## Acceptance criteria
- [ ] `storage.get` returns a value synchronously right after `storage.set`, and returns the snapshot's value for a key never set.
- [ ] `storage.set` does not throw when the send rejects, and the value is still readable.
- [ ] A snapshot with a missing or wrong-typed field is rejected by validation, and the boot error path is taken.
- [ ] With Tauri absent, the page mounts with the browser host: `npm run snapshot` still draws the workbench and reports no policy violation.
- [ ] `@tauri-apps/api` is imported only in `src/host/ipc.ts`; `npm run lint` fails if another file imports it.
- [ ] `npm run check`, `npm run lint`, `npm test` and `cargo xtask web` pass.

## Test / verification plan
- In `desktop/apps/pistudiodesktop`: `npm run check && npm run lint && npm test`.
- `npm run build && npm run snapshot -- --out /tmp/ui.png`, then look at the image.
- `cargo xtask web` in `desktop/`.
- Behaviour in the real webview is checked in task-004.

## Notes
- **Found at planning time:** the spec says a failed boot shows an error. A page with no Tauri at all is a different case (the snapshot tool, a browser on the dev server) and gets the browser host, or `npm run snapshot` stops being usable. Task sprint-106/task-003 records this in the spec.
- Runs in parallel with task-002: no shared file.
- `main.tsx` keeps the font, reset and stylesheet imports in their current order.
