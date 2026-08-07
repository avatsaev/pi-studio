# Task 001 — Atomic JSON store primitive

- **Sprint:** sprint-003-persistence-config
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-003 (sprint-001)

## Goal
Implement the file-based JSON store primitives — atomic write (temp + rename) and validated load with
defaults — that all daemon stores build on.

## Scope references
- `clean-room-scope/architecture/persistence.md` § Behavior & Algorithms, § Error Handling
- `clean-room-scope/MAIN-SCOPE.md` § 5 (Data Model Overview)

## What to build
- In `packages/server`, a persistence module:
  - `atomicWriteJson(path, data, schema)`: Zod-validate, write `{path}.tmp` in the **same directory**,
    fsync, rename → `{path}` (atomic on POSIX).
  - `loadStore(path, schema, defaults)`: if missing → defaults; parse + `safeParse`; normalize legacy
    entries hook; return value or defaults; never crash on corrupt JSON.
  - A directory-layout helper `ensureDirectoryLayout(home)` creating `agents/`, `schedules/`, `chat/`,
    `projects/`, `loops/`.
- A non-atomic, queue-serialized write variant for the loop store.

## Out of scope
- Specific entity schemas (task-004), config (task-002/003).

## Acceptance criteria
- [ ] A crash simulated between temp-write and rename leaves the previous file intact.
- [ ] Loading a missing file returns defaults; loading corrupt JSON falls back without throwing.
- [ ] The queued non-atomic writer serializes concurrent writes in order.
- [ ] `ensureDirectoryLayout` creates all required subdirectories idempotently.

## Test / verification plan
- Tests: `npx vitest run .../atomic-store.test.ts` — temp/rename, missing, corrupt, concurrent-queue.

## Notes
- No migration framework: forward-compat is optional fields + defaults + inline normalization.
