# Task 002 — `file_read_request` reads regular files only, and never more than its limit

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (files, both bootstraps)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-155/task-004

## Goal
Reading a device, a pipe or a file that lies about its size cannot hang the daemon or fill its memory.

## Context / why
Finding F3, folded into M5 by the owner. The handler checks `stat.size` and then reads the whole file.
`/dev/zero` reports size 0 and never ends; a FIFO blocks on open. The same code is copied in
`bootstrap.ts` and `dev-bootstrap.ts`. `file-transfer.ts` already has the right guard.

## Scope references
- `docs/daemon-audit-handoff.md` § F3
- `packages/server/src/daemon/bootstrap.ts` (:740-765), `dev-bootstrap.ts` (:459-482)
- `packages/server/src/files/file-transfer.ts` (the guard near :365-380), `files/limits.ts`
  (`MAX_INLINE_FILE_READ_BYTES`)
- `packages/server/src/daemon/bootstrap.test.ts` (:1136-1225)

## What to build
One function in `files/`, used by both daemons: it refuses anything that is not a regular file with
`not_a_file` before opening it, and reads at most the limit plus one byte, answering `file_too_large`
when there is more, whatever `stat` said.

## Out of scope
Paging large files.

## Acceptance criteria
- [ ] A FIFO answers `not_a_file` at once; `/dev/zero` answers `not_a_file`.
- [ ] A file that grows past the limit between the size check and the read answers `file_too_large`.
- [ ] The existing tests (small file, over the limit, directory, `~`) pass, in both daemons.

## Test / verification plan
- `npx vitest run packages/server/src/files packages/server/src/daemon`
- `npm run build:server`
