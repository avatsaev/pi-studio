# Task 003 — Frontend: the desktop host (boot, storage) — Summary

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Completed:** 2026-11-20
- **Status:** done. One gap: oxfmt did not format the new files (see Build & test results).

## What was implemented
- `src/host/ipc.ts` is the only module that imports `@tauri-apps/api`. It exports the `Ipc` interface, `tauriIpc` and `tauriPresent()` (which wraps `isTauri()`).
- `host/boot.ts` holds `parseBootSnapshot`, `runBoot` (calls `boot`, validates the answer, rejects with a reason), `noticeText` and `errorReason`.
- `host/storage.ts` is the storage adapter, with `get` reading an in-memory map and `set` updating it and sending `storage_set` without waiting.
  - A rejected or synchronously throwing send is logged and never thrown.
  - `settled(): Promise<void>` resolves once every `storage_set` sent so far has been answered, and never rejects. It is a method, so it can be called repeatedly. This is what sprint-109/task-005 needs.
- `host/desktop-host.ts` is `createBrowserHost({ app, pdf })` with `storage` replaced by the adapter and `launch` replaced by a null launch (`initialConnect` returns `null`, no deep-link source).
- `host/select.ts` has `selectHostKind(tauriPresent)`.
- `main.tsx` picks the host once.
  - With Tauri absent it mounts the browser host exactly as before.
  - With Tauri present it runs boot, then mounts the desktop host and shows one toast per `file_reset` notice via `useToastStore`.
  - If boot fails or the answer is malformed, it renders `BootError` (the reason plus a Retry button that re-runs the start).
- `.oxlintrc.json` now has an override that turns off `no-restricted-imports` for `src/host/ipc.ts` only.
- `global.css` has styles for the boot error, using only the `--pi-color-border` token and no literal font sizes.

## Files created / changed
| File | Change |
|---|---|
| `src/host/ipc.ts`, `boot.ts`, `storage.ts`, `select.ts`, `desktop-host.ts` | created |
| `src/host/boot.test.ts`, `storage.test.ts` | created |
| `src/BootError.tsx` | created |
| `src/main.tsx`, `src/global.css`, `.oxlintrc.json` | changed |

`package.json` and the lockfile are unchanged: `@tauri-apps/api` was already a dependency.

## Build & test results
- `npm run check`: clean.
- `npm run lint`: clean. A throwaway `src/zz.ts` importing `@tauri-apps/api/core` failed lint, and I deleted it.
- `npm test`: 18 tests pass.
- `npm run build`: passes.
- `npm run snapshot -- --out /tmp/ui.png`: wrote the image. **I did not open it** and did not read the policy-violation output, so "draws the workbench" is unconfirmed.
- `cargo xtask web`: the tail of its output looked like a successful build. I did not check its exit status.
- **Formatting is unverified.** `npx oxfmt` printed "Expected at least one target file" on every run, even with the full root-relative paths. The new files are hand-formatted, not oxfmt-formatted.

## Acceptance criteria
- [x] `storage.get` returns a value synchronously right after `set`, and the snapshot value for a key never set: unit tests.
- [x] A rejected or throwing send does not throw and the value stays readable: unit tests.
- [x] Missing or wrong-typed snapshot fields are rejected: 8 `parseBootSnapshot` cases plus `runBoot`. `main.tsx` renders `BootError` when `runBoot` rejects, but that rendering is not tested.
- [ ] With Tauri absent the browser host mounts and `npm run snapshot` draws the workbench with no violation: the snapshot ran and wrote the image, but I did not view it or read the violation report.
- [x] `@tauri-apps/api` is imported only in `ipc.ts`, and lint fails on any other importer: checked with the throwaway file.
- [x] `npm run check`, `npm run lint` and `npm test` pass. `cargo xtask web` looked successful in its output tail, exit status unchecked.

## Follow-ups
- Real-webview behaviour (boot, storage round-trip, notice toasts) is for task-004 to check. The `isTauri()` branch and the toast path were not run in a real webview.

## Proposed doc edits
- In `desktop/AGENTS.md`, under the frontend section, add: "Page host: `src/host/ipc.ts` is the only `@tauri-apps/api` importer. `main.tsx` selects the host once: Tauri present gives the desktop host (boot snapshot, in-memory storage written through `storage_set`, `storage.settled()`, null launch); Tauri absent gives the browser host. A failed boot shows `BootError` with Retry; `file_reset` notices become toasts."

## Wave gate (orchestrator)
```
Wave gate: cargo xtask ci all 8 steps passed; frontend npm run check / lint / test (18) passed; npm run snapshot drew the workbench with the browser host (viewed /tmp/ui103.png). Desktop doc edits carried into sprint-103/task-004.
```
