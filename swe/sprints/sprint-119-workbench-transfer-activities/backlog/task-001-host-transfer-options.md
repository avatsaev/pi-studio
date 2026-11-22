# Task 001 — Host contract: `TransferOptions`, and cancel and progress in the browser host (R2, S7)

- **Sprint:** sprint-119-workbench-transfer-activities
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench/src/host
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
`files.upload` and `files.saveToDisk` take the same options (progress, state, abort), and the browser host honours them.

## Context / why
A save reports nothing and nothing can be cancelled. The SDK already aborts uploads and downloads and reports download progress. Compatibility is not kept (R2): `UploadOptions` is renamed, with no alias.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 6, decisions R2, S7, D8
- `swe/architecture/workbench-host-adapter.md` (the 2026-11-22 amendment: its rows move into the contract here)
- `packages/workbench/src/host/types.ts`, `browser-files.ts`, `files.test.ts`, `host-members.test.ts`, `packages/workbench/src/test/test-host.ts`, the package's `index.ts` exports
- `packages/client/src/file-transfer-client.ts` (`upload`'s `signal`, `downloadTo`'s `signal` and `onProgress`)
- `desktop/apps/pistudiodesktop/src/host/transfers.ts` (`countTransfers` forwards arguments; it must still compile)

## What to build
- `types.ts`: `TransferState`, `TransferOptions { onProgress?, onStateChange?, signal? }`; `upload(dir, source, options?: TransferOptions)`; `saveToDisk(path, options?: TransferOptions)`. `UploadOptions` is gone from the repository.
- Browser `upload`: `signal` goes to the SDK. Browser `saveToDisk`: the `Blob` path passes `signal` and reports progress against the answer's `totalBytes`; the `saveTarget` path reports the bytes written against `totalBytes`, stops between or inside ranges on abort, calls `discard()` once and rejects with an `AbortError`. A host never calls a callback of a save before the user has chosen a destination (the `saveTarget` returned).
- The browser host never calls `onStateChange` (it is always running).
- The test host records the options and can, on request, call the callbacks and react to the signal.
- `workbench-host-adapter.md`: the contract's shape, member contracts and browser-host table carry the new members; the amendment section becomes history. `packages/workbench/AGENTS.md` and `README.md` where they list the host's members.

## Out of scope
- Any UI (task-002, task-003).
- The desktop host's engine-backed members (sprint 122).

## Acceptance criteria
- [ ] Given an upload whose signal aborts, then the SDK's upload was given that signal and the promise rejects with an error named `AbortError`.
- [ ] Given a save through a `SaveTarget`, then `onProgress` rises to `totalBytes`; given an abort in the middle, `discard` ran once, `finish` never, and the rejection is an `AbortError`.
- [ ] Given a save through the `Blob` path, then progress is reported and an abort rejects with an `AbortError` without clicking the anchor.
- [ ] `grep -r UploadOptions packages desktop/apps` finds nothing; `(cd desktop/apps/pistudiodesktop && npm run check)` passes.

## Test / verification plan
- `npx vitest run packages/workbench/src/host`
- `npm run typecheck`; `npm run lint`; `npx oxfmt <changed files>`
- `(cd desktop/apps/pistudiodesktop && npm run check && npm test)`

## Notes
- After a signature change run `tsc -b --force` once: stale `.tsbuildinfo` hides errors.
- Merging a change under `packages/workbench` publishes an npm release: this stays on the feature branch.
