# Task 006 — Browser host: build download Blobs from chunks — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`files.saveToDisk` and `files.openForView` in the browser host now call the SDK's `downloadTo` through a module-level `downloadAsBlob`, collect the delivered chunks and build `new Blob(chunks, { type })` from them (type, file name and MIME type from the resolved download info). `toBlob` and every call to `download` are gone from `browser-files.ts`. The `WorkbenchHost` contract is unchanged.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/browser-files.ts` | `downloadAsBlob`; `toBlob` removed |
| `packages/workbench/src/host/files.test.ts` | the view test drives `downloadTo` (no `download` on the fake client) and checks the Blob's type and bytes; new test for `saveToDisk`'s anchor |
| `packages/workbench/AGENTS.md` | `browser-files.ts` entry |

## Build & test results
```
$ npx vitest run packages/workbench/src/host      Test Files 8 passed / Tests 48 passed
$ npm run build:workbench; npx tsc -b packages/workbench   success (check-dist: ok)
$ npx oxfmt <changed files>; npx oxlint packages/workbench/src/host   no findings in changed code
```

## Acceptance criteria
- [x] `browser-files.ts` no longer calls `download`; no concatenation (the test client has no `download`).
- [x] `saveToDisk` clicks an anchor named by the daemon's file name; `openForView` returns `{ url, mimeType?, fileName?, release() }` with idempotent `release`.
- [x] Host tests and the browser-API guard test pass.

## Follow-ups / TODO(verify)
- The live browser check (save a file, view an image and a PDF) runs in task-007.
