# Task 003 — Save into a host-supplied target — Summary

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
`createBrowserHost({ saveTarget })` makes `files.saveToDisk` stream a daemon file into a shell-supplied `SaveTarget`.

- It asks `saveTarget` for a target with the path's file name. A `null` target resolves with no download request.
- It downloads in 8 MiB ranges through `downloadTo`, one range at a time. Chunks are collected during a range, then each `write` is awaited in order before the next range is requested.
- The first range learns `totalBytes` and `mtimeMs`; every later range sends them as `ifUnchanged`.
- After the last range it awaits `finish`.
- On any failure, including a rejecting `write` or `finish`, it awaits `discard` once and rethrows the original error.
- An empty file produces one `finish` and no `write`.
- Without `saveTarget`, the Blob and anchor path is unchanged.
- If a range returns zero bytes before the end of the file, it throws instead of looping forever. The task did not ask for this guard.

## Files changed
| File | Change |
|---|---|
| `packages/workbench/src/host/types.ts` | Added `SaveTarget`. |
| `packages/workbench/src/host/browser-files.ts` | Added `saveIntoTarget` and a `saveTarget` parameter on `createBrowserFiles`. |
| `packages/workbench/src/host/browser-host.ts` | Added `BrowserHostOptions.saveTarget` and passed it through. |
| `packages/workbench/src/index.ts` | Exported `SaveTarget`. |
| `packages/workbench/src/host/files.test.ts` | Added 6 tests. |

`test-host.ts` needed no change.

## Build & test results
- `npx vitest run packages/workbench/src/host`: 53 tests pass, including the 5 existing save and view tests.
- `npm run build:workbench` and `npm run build:web-client`: both pass.
- `npx oxfmt` on the changed files: clean.
- `npm run lint`: no errors. The warnings I saw were in `packages/client/src/daemon-client.ts`, which I did not touch. I read only the last 5 lines of lint output, so I did not check the rest for warnings in my files.
- I did not run the desktop check, since the desktop host types did not change.

## Acceptance criteria
- [x] Writes arrive in file order and equal the file: the test checks every byte against the expected pattern.
- [x] The next range is requested only after the previous range's writes resolve: the test asserts the exact call log, one range outstanding at a time.
- [x] A `null` target makes no request and resolves: test.
- [x] A failure in range 3 of 5 calls `discard` once, never `finish`, and rejects with that error: test.
- [x] A `changed` error between ranges rejects and discards: test.
- [x] A zero-byte file calls `finish` once and never `write`: test.
- [x] The existing save tests pass unchanged: test run.

## Follow-ups
None.

## Proposed doc edit (`packages/workbench/README.md`, § The host)
> `createBrowserHost({ saveTarget })` — optional `(suggestedName) => Promise<SaveTarget | null>`. With it, "Download" saves into the target instead of a Blob and anchor. `null` means the user cancelled, and nothing happens. The file is fetched in 8 MiB ranges. The first range reads the file's size and modification time, and later ranges send them as `ifUnchanged`. Each range's chunks go through `target.write`, awaited in order, before the next range is requested. `finish()` runs after the last range. On any failure, `discard()` runs once and the original error is rethrown. `SaveTarget` is exported from the package root.

Optionally, add a line to `packages/workbench/AGENTS.md`: `host/browser-files.ts` — `saveIntoTarget`, the ranged save loop (8 MiB ranges, awaited writes, `ifUnchanged`).

## Wave gate (orchestrator)
```
npx vitest run packages/workbench: 118 files / 1510 tests passed; npm run build:workbench OK; npm run typecheck OK. Orchestrator hoisted two capture-free test helpers (fake, download) in host/files.test.ts to module scope (oxlint consistent-function-scoping), re-ran: 16 passed, no warnings in the file. README host section + AGENTS browser-files entry updated by the orchestrator.
```
