# Task 001 — `Begin` metadata: `mtimeMs`, `offset`, `length`

- **Sprint:** sprint-097-download-ranges
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol (binary-frames)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
The file-transfer `Begin` frame can carry the three fields a ranged download announces.

## Context / why
A download will tell the client which bytes follow and which version of the file they come from. The `Begin` metadata schema has `totalBytes` already but nothing for the range or the modification time, so the daemon cannot send them and a client cannot decode them through the shared codec.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 1.3 (Binary frames), § 1.2 (`mtimeMs` is an integer)
- `packages/protocol/src/binary-frames/file-transfer-protocol.ts` (`fileTransferBeginSchema`, `encodeFileTransferFrame`, `decodeFileTransferFrame`)
- `packages/protocol/src/binary-frames/file-transfer-protocol.test.ts`

## What to build
- `fileTransferBeginSchema` gains three optional fields, each a non-negative integer: `mtimeMs`, `offset`, `length`.
- Tests: a `Begin` with all of `totalBytes`, `mtimeMs`, `offset`, `length` survives encode then decode unchanged; a `Begin` without them still decodes (uploads, and downloads from an older daemon); a fractional `mtimeMs` does not validate.

## Out of scope
- The `fileDownloadRanges` feature flag and any daemon behaviour (task-002).
- The binary fixture for a download `Begin` (task-005).

## Acceptance criteria
- [ ] `FileTransferBegin` has optional `mtimeMs`, `offset` and `length`, and the codec round-trips them.
- [ ] Every existing protocol test passes, including `external-binary-fixtures.test.ts` (the existing `Begin` fixture is untouched).

## Test / verification plan
- `npx vitest run packages/protocol/src/binary-frames packages/protocol/src/external-binary-fixtures.test.ts`
- `npm run build:protocol`
- `npx oxfmt <changed files>`

## Notes
- Additive only: no existing field changes, so the binary fixtures and their manifest stay as they are.
