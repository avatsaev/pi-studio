# Task 001 — Daemon trimmed destination basename — Summary

- **Sprint:** sprint-047-file-explorer-rename
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

Fixed the `moveEntry` validate-trimmed/join-untrimmed split in `FileExplorerService`: the
destination basename is now trimmed **once**, and that trimmed value is used for both the
`join(destinationParent, destName)` and the existing legality guard. Previously the guard at
`file-explorer.ts:195` validated `basename(inputDestination).trim()` while the join at `:190`
used the untrimmed `basename(inputDestination)`, so a free-text destination like `foo.txt `
passed validation as `foo.txt` and then landed on disk **with** the trailing space. Behavior
now matches `createEntry`, which already trims its `rawName` before validating and joining.
The fix is the minimal reorder — no new validation branches, no behavior change for already-clean
paths (a trim is a no-op for them).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/file-explorer.ts` | modified — hoisted `destName` before the join, joined with it, added a rationale comment |
| `packages/server/src/files/file-explorer.test.ts` | added 2 tests to the `moveEntry` suite |

## How it satisfies the scope

Implements sprint-047 task-001 against `clean-room-scope/features/file-explorer-move.md` §
Behavior & Algorithms ("Every rejection is decided here so the client never has to duplicate a
legality rule"). No deviation from the task file. Doc-sync: no-op — the spec describes move
semantics generically and never claimed padding was preserved; `createEntry`'s trimming is the
established convention this aligns with.

## Build & test results
```
$ npm run build:server
tsc -b packages/server — success (exit 0)

$ npx oxlint packages/server/src/files/file-explorer.ts packages/server/src/files/file-explorer.test.ts
$ npx oxfmt --check packages/server/src/files/file-explorer.ts packages/server/src/files/file-explorer.test.ts
All matched files use the correct format. — clean

$ npx vitest run packages/server/src/files/file-explorer.test.ts
Test Files  1 passed (1)
     Tests  40 passed (40)   # 38 pre-existing + 2 new
```

## Acceptance criteria
- [x] Given an existing file and a destination basename with leading/trailing spaces, when `moveEntry` is called, then the on-disk name is the trimmed one — verified by the new "moves to the trimmed destination basename" test (`destination` echoed trimmed, padded path absent, source gone)
- [x] Given a whitespace-only destination basename, when `moveEntry` is called, then the result is `invalid_name` and the source is untouched — verified by the new "returns invalid_name when the destination basename is only whitespace" test
- [x] Existing move/rename behavior unchanged — all 38 pre-existing `moveEntry`/service tests still pass

## Follow-ups / TODO(verify)
- None. The client-side trim in the rename UI (sprint tasks 003–006) remains as defense in depth,
  and now also keeps the UX clean (no silent rename to a name the user didn't type).
