# Task 001 — Host contract: `TransferOptions`, and cancel and progress in the browser host — Summary

- **Sprint:** sprints/sprint-119-workbench-transfer-activities
- **Completed:** 2026-11-22
- **Status:** done

## What was implemented
- `UploadOptions` is renamed `TransferOptions` with no alias. It is now `{ onProgress?(done, total?), onStateChange?(state), signal? }`, with a new `TransferState = "queued" | "running" | "waiting"`. Both are exported from the package root.
- `files.upload(dir, source, options?: TransferOptions)` and `files.saveToDisk(path, options?: TransferOptions)`.
- **Browser upload:** `signal` and `onProgress` go to the SDK, so an abort rejects with the SDK's `AbortError`.
- **Browser save, `Blob` path:** `signal` and the SDK's `onProgress` are forwarded. The SDK's progress length is the file size because the request has no range.
  - An abort that races the last chunk throws an `AbortError` before the object URL is made, so the anchor is not clicked.
  - An already-aborted signal makes no request.
- **Browser save, `saveTarget` path:**
  - `onProgress(written, totalBytes)` runs after each `write`. An empty file reports `(0, 0)` once.
  - The signal is checked before each range, before each write and before `finish`. The SDK checks it inside a range.
  - On abort, `discard()` runs once, `finish()` never, and the call rejects with an `AbortError`.
  - Neither callback runs before `saveTarget` has answered. A destination chosen after the abort is discarded.
- The browser host never calls `onStateChange`.
- **Test host** (`src/test/test-host.ts`):
  - `transfers` is a new list. Each entry holds the kind, the target, the options, and `progress()`, `state()`, `finish()`, `fail()`.
  - `holdTransfers: true` keeps calls pending until `finish()` or `fail()`.
  - A call whose signal aborts rejects with an `AbortError`.
  - `calls` args are unchanged.
- **Docs:** the host adapter architecture doc, `packages/workbench/AGENTS.md` and `README.md`, and `packages/client/AGENTS.md`.
  - In the architecture doc, the 2026-11-22 amendment is now a history section. Its desktop-host row is marked "Not built: sprint 122".

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/types.ts` | `TransferState`, `TransferOptions` (replaces `UploadOptions`); new signatures on `HostFiles` |
| `packages/workbench/src/host/browser-files.ts` | `signal` and progress for upload and both save paths; abort handling |
| `packages/workbench/src/index.ts` | exports `TransferOptions`, `TransferState` |
| `packages/workbench/src/hooks/use-file-transfer.ts`, `features/files/upload-sources.ts` | type rename only |
| `packages/workbench/src/test/test-host.ts` | `transfers`, `holdTransfers`, abort-aware calls |
| `packages/workbench/src/host/files.test.ts` | 12 new tests, the `fake()` helper extended, `stubAnchor()` helper |
| `packages/workbench/src/host/host-members.test.ts` | 3 new test-host tests |
| `packages/client/src/file-transfer-client.ts` | SDK's own `UploadOptions` renamed `UploadSendOptions` (see Deviations) |
| `swe/architecture/workbench-host-adapter.md` | status line, shape, member contracts, browser-host table, error row, history section |
| `packages/workbench/AGENTS.md`, `packages/workbench/README.md`, `packages/client/AGENTS.md` | member lists and the renamed SDK type |

## How it satisfies the scope
- Spec § 6 and decisions R2, S7 and D8 are met for the contract, the browser host and the test host.
- **Deviation:** the SDK exported its own `UploadOptions`, and `grep -r UploadOptions packages` has to come back empty. I renamed it to `UploadSendOptions` in `packages/client`. A second exported `TransferOptions` with a different shape would have been confusing. No other package referenced it.
- `desktop/apps/pistudiodesktop/src/host/transfers.ts` needed no change: `countTransfers` forwards its arguments, and it compiles against the new signatures.
- The `useFileTransfer().saveToDisk(path)` hook is unchanged. Passing options through it belongs to the UI tasks.

## Build & test results
```
$ npx vitest run packages/workbench/src/host
8 files passed, 73 tests passed (files.test.ts 28, host-members.test.ts 13), 0 failed

$ npx tsc -b --force          # same as `npm run typecheck`, forced
exit 0

$ throwaway tsconfig over files.test.ts, host-members.test.ts and test-host.ts
  (the workbench tsconfig excludes tests); file deleted afterwards
0 errors

$ npm run lint
exit 0; 62 warnings, none in changed files (existing ones in pdf.test.ts, browser-worker-timers*.ts, ui-library, relay-transport.ts)

$ npx oxfmt <changed .ts files>; npx oxfmt --check packages/workbench/src packages/client/src
All matched files use the correct format.

$ (cd desktop/apps/pistudiodesktop && npm run check && npm test)
tsc -b: exit 0; vitest 24 files, 195 tests passed

$ grep -rn UploadOptions packages desktop/apps (excluding node_modules, dist, target)
no matches
```

## Acceptance criteria
- [x] An upload whose signal aborts: the SDK's `upload` got that signal, the promise rejects with an `AbortError`, and `onStateChange` is never called. Verified by `hands the SDK the abort signal and rejects with an AbortError when it aborts`.
- [x] A save through a `SaveTarget`: `onProgress` rises to `totalBytes`; an abort in the middle gives one `discard`, no `finish`, and an `AbortError`.
  - Verified by `reports the bytes written after each write…`, `…abort in the middle of a range…`, `stops between writes…`, `…during the very last write` and `discards a destination chosen after the abort…`.
  - The callback-ordering rule is covered by `calls no callback before the user has chosen a destination` and `makes no request and calls no callback when the target is cancelled`.
- [x] A save through the `Blob` path reports progress, and an abort rejects with an `AbortError` without clicking the anchor. Verified by the three `saving through a Blob` tests.
- [x] `grep -r UploadOptions packages desktop/apps` finds nothing. `(cd desktop/apps/pistudiodesktop && npm run check)` passes.

## Follow-ups / TODO(verify)
- `swe/features/desktop-transfer-engine.md` still names `UploadOptions` in R2 and § 6. Those lines name the old type on purpose, so I left them (outside this task's file list).
- Not run, by assignment: `cargo`, the whole-monorepo vitest suite, and the `packages/client` test suite. The SDK change is a type rename that `tsc -b --force` accepted.
- Merging a change under `packages/workbench` publishes an npm release, so this stays on `feat/desktop-transfer-engine`.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 292 files, 4159 tests passed
npm run fmt:check -> 28 files flagged, all pre-existing and none changed by this wave
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```
