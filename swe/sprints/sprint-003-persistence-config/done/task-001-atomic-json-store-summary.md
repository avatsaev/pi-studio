# Task 001 — Atomic JSON store primitive — Summary

- **Sprint:** sprint-003-persistence-config
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Created the file-based JSON store primitives in `packages/server/src/persistence/atomic-store.ts`
that every daemon store builds on:
- `atomicWriteJson(path, data, schema)` — Zod-validates, writes a unique `{path}.<pid>.<rand>.tmp`
  in the **same directory**, `fsync`s, then `rename`s over `path` (atomic on POSIX); orphan temp is
  unlinked if the rename fails.
- `loadStore(path, schema, defaults, { normalize? })` — missing file → defaults; corrupt/partial
  JSON → defaults (never throws); optional `normalize` hook rewrites raw JSON before validation
  (inline legacy migration, no migration framework). Built on `safeParseOrDefault` from protocol.
- `ensureDirectoryLayout(home)` — idempotently creates `agents/`, `schedules/`, `chat/`,
  `projects/`, `loops/` (exported as `STORE_SUBDIRECTORIES`).
- `createQueuedJsonWriter()` — returns a `QueuedWriter` that serializes writes through an in-memory
  FIFO promise queue and writes **non-atomically** (for the loop store).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/persistence/atomic-store.ts` | created |
| `packages/server/src/persistence/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports persistence |
| `packages/server/src/persistence/atomic-store.test.ts` | added — 8 tests |

## How it satisfies the scope
- **persistence.md § Behavior & Algorithms:** `atomicWriteJson` and `loadStore` reproduce the
  documented pseudocode (validate → temp → fsync → rename; missing/corrupt → defaults; normalize
  hook). The queued non-atomic writer matches "Loop store writes are direct (not atomic) and queued".
- **persistence.md § Error Handling:** missing file → defaults; corrupt JSON → defaults without
  crashing; crash mid-write leaves the primary intact (temp discarded).
- **MAIN-SCOPE §5:** directory layout helper creates the on-disk subdirectories.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/persistence/atomic-store.test.ts
 ✓ atomic-store.test.ts (8 tests)
 Test Files  1 passed (1)      Tests  8 passed (8)
$ npx oxlint packages/server   → clean
$ npx oxfmt --check ...        → clean
```

## Acceptance criteria
- [x] A crash simulated between temp-write and rename leaves the previous file intact (stray `.tmp`
      present; primary byte-identical and loads as v1).
- [x] Loading a missing file returns defaults; corrupt JSON falls back without throwing.
- [x] The queued non-atomic writer serializes concurrent writes in order (FIFO completion order
      `[0..9]`, last value wins on disk).
- [x] `ensureDirectoryLayout` creates all required subdirectories idempotently.

## Follow-ups / TODO(verify)
- Temp-file naming uses a `<pid>.<rand>` suffix (scope literally says `{path}.tmp`); the unique
  suffix is a safe superset that avoids concurrent-writer temp collisions.
- Whether `loadStore` should *reject* (vs. fall back) on corrupt JSON is config-dependent per scope
  ("Reject or fall back"); chose fall-back-to-defaults so the daemon cannot be crashed.
