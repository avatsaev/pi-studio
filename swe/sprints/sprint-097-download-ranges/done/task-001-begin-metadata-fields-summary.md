# Task 001 — `Begin` metadata: `mtimeMs`, `offset`, `length` — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`fileTransferBeginSchema` gained three optional non-negative integer fields (`mtimeMs`, `offset`, `length`), so the shared codec can encode and decode a ranged download's `Begin`. Additive only; the existing binary fixtures are untouched.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/binary-frames/file-transfer-protocol.ts` | modified (three schema fields) |
| `packages/protocol/src/binary-frames/file-transfer-protocol.test.ts` | added 3 tests (round-trip, absent fields still decode, fractional `mtimeMs` rejected) |

## How it satisfies the scope
Follow-ups II § 1.3 (`Begin` metadata) and § 1.2 (`mtimeMs` is an integer). No doc text described the `Begin` schema, so no package docs changed.

## Build & test results
```
$ npx vitest run packages/protocol/src/binary-frames packages/protocol/src/external-binary-fixtures.test.ts
Test Files  4 passed (4) / Tests  56 passed (56)

$ npm run build:protocol
success

$ npx oxfmt <changed files>
success
```

## Acceptance criteria
- [x] `FileTransferBegin` has optional `mtimeMs`, `offset` and `length`, and the codec round-trips them (new round-trip test).
- [x] Every existing protocol test passes, including `external-binary-fixtures.test.ts`.

## Follow-ups / TODO(verify)
- None.
