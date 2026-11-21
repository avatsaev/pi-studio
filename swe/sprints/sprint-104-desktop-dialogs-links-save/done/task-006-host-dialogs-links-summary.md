# Task 006 — Host dialogs and links — Summary

- **Sprint:** sprint-104
- **Completed:** 2026-11-20
- **Status:** done. `cargo xtask web` was not run.

## What was implemented
- `native.ts` adds `createNativeDialogs(ipc, log)` and `createNativeLinks(ipc, log)`.
  - `confirm` calls `dialog_confirm {message}` and resolves `true` only when the answer is `true`. If the call rejects, it logs and resolves `false`.
  - `alert` calls `dialog_alert {message}` and resolves when the call settles. A rejection is logged.
  - `openExternal` calls `open_external {url}` with the URL unchanged and returns at once. A rejection is logged.
- `createDesktopHost` now sets `dialogs` and `links` from these, using a shared `log` that is also passed to the storage module.

## Files
| File | Change |
|---|---|
| `desktop/apps/pistudiodesktop/src/host/native.ts` | new |
| `desktop/apps/pistudiodesktop/src/host/native.test.ts` | new, unit tests over a fake `ipc` |
| `desktop/apps/pistudiodesktop/src/host/desktop-host.ts` | changed |

## Build & test
In `desktop/apps/pistudiodesktop`:
- `npm run check`, `npm run lint` and `npm run build` pass.
- `npm test` passes (23 tests across 4 files).

`npx oxfmt` on the three files printed "Expected at least one target file", so formatting did not run. These files may not be formatted.

## Acceptance
- [x] `confirm` resolves `true` and `false` as the fake answers, and `false` when the fake rejects. Covered by tests.
- [x] `alert` resolves on success and on rejection. Covered by tests.
- [x] `openExternal` sends the URL unchanged and returns without waiting (the fake never settles). Covered by tests.
- [ ] `cargo xtask web` was not run.

## Follow-ups
- Run `npx oxfmt` on the three files in a way that matches them; my invocation matched none.
- Run `cargo xtask web` in `desktop/`.

## Proposed doc edits
- In the host-adapter section of the desktop docs, state that `dialogs` and `links.openExternal` go through the `dialog_confirm`, `dialog_alert` and `open_external` commands.
- Add that a failed `confirm` answers `false`, and that `openExternal` is fire-and-forget with failures logged.

## Wave gate (orchestrator)
```
Wave gate: cargo xtask ci all 8 steps passed (163 tests); frontend check/lint/test (23) passed. Orchestrator updated the stale config-dir assertion in commands/tests.rs (daemons.json now exists after open).
```
