# Task 002 — `file_read_request` reads regular files only, and never more than its limit — Summary

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
New `files/inline-read.ts` `readInlineFile`, used by both daemons' `file_read_request`: a directory still answers `is_directory`; any other non-regular file (FIFO, device, socket) answers `not_a_file` from `stat` before opening; the file is then opened `O_NONBLOCK`, re-checked with `fstat` and read for at most limit + 1 bytes, answering `file_too_large` whatever `stat` said.

## Files changed
`files/inline-read.ts` (+test), `daemon/bootstrap.ts` and `dev-bootstrap.ts` (the handler; unused imports removed), `daemon/bootstrap.test.ts` (one case), `packages/server/AGENTS.md`.

## Build & test results
```
npx vitest run packages/server/src/files packages/server/src/daemon/bootstrap.test.ts -> 7 files, 184 passed; build:server OK; oxfmt/oxlint clean
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] A FIFO and `/dev/zero` answer `not_a_file` at once (the FIFO test has a 5 s timeout so a hang fails)
- [x] A file whose `stat` under-reports its size, over the limit, answers `file_too_large`
- [x] The existing tests (small file, over the limit, directory, `~`) pass

## Follow-ups / TODO(verify)
- The daemon-level tests run through `startDevDaemon`; `bootstrap.ts` has identical delegation code and is covered by the build.
