# Task 001 — Deleting a symlink removes the link, not what it points to

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (file explorer)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
Deleting a symlink in the file explorer leaves its target alone.

## Context / why
Finding F1, folded into M5 by the owner. `deleteFile` resolves the real path and removes that
recursively, so deleting a link to a directory removes the directory. The root and the home directory
are not refused. `moveEntry` in the same file already does it right: it resolves only the parent.

## Scope references
- `docs/daemon-audit-handoff.md` § F1
- `packages/server/src/files/file-explorer.ts` (`deleteFile` :349-362, `moveEntry` :178-253)
- `packages/server/src/files/file-explorer.test.ts` (:132-176; the test at :157 asserts today's wrong
  behaviour and must be reversed)

## What to build
`deleteFile` resolves the parent directory only, `lstat`s the entry and removes the entry itself. A
request to delete `/`, the home directory, or a path that resolves to either is refused with an error
code.

## Out of scope
A sandbox for file requests (deliberately absent).

## Acceptance criteria
- [ ] A link to a directory: the link is gone, the directory and its contents remain.
- [ ] A link to a file, a broken link, a plain file and a plain directory all delete correctly.
- [ ] `/` and `~` are refused.

## Test / verification plan
- `npx vitest run packages/server/src/files`
- `npm run build:server`
