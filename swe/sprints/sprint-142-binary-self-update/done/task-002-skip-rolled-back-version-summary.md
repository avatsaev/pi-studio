# Task 002 — A rolled-back version is skipped — Summary

- **Sprint:** sprint-142-binary-self-update
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`update-service.ts`: `UpdateSkipStore`, `createFileSkipStore(path, logger)` (missing = none; unreadable/malformed = removed and logged), `UPDATE_SKIP_FILE = "update-skip.json"`. When `update-result.json` is read (start or the 30 s watch) with outcome `rolled_back` or `failed` the service records `{version: to}`; `updated` writes nothing; a newer latest clears it; the automatic check stays idle on the skipped version and a manual check offers it; `status.skippedVersion` is set while held. `MANUAL_UPDATE_COMMANDS.unmanaged_binary` = the releases page. The orchestrator wired `createFileSkipStore(join(home, UPDATE_SKIP_FILE), logger)` into `daemon/bootstrap.ts` (the agent's own scope excluded it). Tests: a `skipped version (D14)` block; docs in `packages/server/AGENTS.md` and root `AGENTS.md`.

## Results
`npx vitest run packages/server/src/update` 118 passed; `tsc -b` clean.

## Acceptance
- [x] All install kinds skip; file persisted; manual check still offers it.

## Follow-ups
`PI_STUDIO_DEV_UPDATE=skipped` for the dev daemon script is not added (out of the task's files; the workbench was not shown this state live).
