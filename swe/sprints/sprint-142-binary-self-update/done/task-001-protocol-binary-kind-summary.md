# Task 001 — Protocol: `binary` kind, `unmanaged_binary`, `skippedVersion` — Summary

- **Sprint:** sprint-142-binary-self-update
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`packages/protocol/src/messages.ts`: `installKind` gains `binary`, the status gains `skippedVersion?: string`, the `cannot_update.reason` comment names `unmanaged_binary` (the reason was already an open string). `packages/client` needed no change (types come from protocol). New test case in `daemon-update.test.ts`; `packages/protocol/AGENTS.md`. The `daemon_update_*` family has no external fixtures, so fixtures/CHANGELOG are untouched. Root `AGENTS.md` updated by the orchestrator.

## Results
`npx vitest run packages/protocol packages/client` 606 passed; `tsc -b` clean; oxfmt/oxlint clean.

## Acceptance
- [x] Schemas, tests, docs.
