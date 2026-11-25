# Task 001 — Deleting a symlink removes the link, not what it points to — Summary

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`deleteFile` expands `~`, resolves the path, `realpath`s only the parent directory, `lstat`s the entry and removes the entry itself (the `moveEntry` approach), so deleting a link to a directory leaves the directory. `/` and the home directory (including `~`, `/.`, `/tmp/..`, `~/x/..`) are refused with `protected_path`; a missing path or parent is `not_found`.

## Files changed
`packages/server/src/files/file-explorer.ts`, `file-explorer.test.ts` (the test that asserted the old behaviour is reversed), `packages/server/AGENTS.md`.

## Build & test results
```
npx vitest run packages/server/src/files/file-explorer.test.ts -> 47 passed; build:server OK; oxfmt/oxlint clean
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] A link to a directory: the link is gone, the directory and its contents remain
- [x] A link to a file, a broken link, a plain file, a plain directory and a symlinked parent all delete correctly
- [x] `/` and `~` are refused
