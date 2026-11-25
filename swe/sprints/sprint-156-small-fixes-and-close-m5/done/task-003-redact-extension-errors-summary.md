# Task 003 — No credentials in extension error text — Summary

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`sync-executor.ts` runs the stderr tail, a thrown error's text, the stored and logged `source` and the report's identity and source through `redactSource` before the 2 KiB cut (`updateInstalledExtensions` too). `wire.ts` redacts `source`, `identity` and `lastError.message` on the way out, so a state file written by an earlier version never reaches a client unredacted (the CLI's `extensions list --local` shares that path). `install-processes.ts` keeps only a 64 KiB tail of stderr (decoded as UTF-8 across chunks; a cut drops its leading partial token so a split URL cannot slip past the redactor) and resolves on `close`.

## Files changed
`extensions/{sync-executor,wire,install-processes}.ts` and tests (`sync-executor.test.ts`, `extensions-rpc.test.ts`, `install-processes.test.ts`); `packages/server/AGENTS.md`.

## Build & test results
```
npx vitest run packages/server/src/extensions packages/server/src/resources -> 212 passed (three runs); build:server OK; oxfmt/oxlint clean
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] `https://user:secret@host/repo.git` and `?token=abc` in stderr, a thrown error and the source: no secret in the state file, the log lines, the report or the update error
- [x] A state file written before this change, with a secret, reaches a client redacted
- [x] 10 MiB of stderr: at most 64 KiB kept, the last line intact, the tail never starts mid-URL

## Follow-ups / TODO(verify)
- The state-file key `failures[identity]` and `offered[].installedSpec` stay verbatim (compared byte for byte with settings; they come from the bundled curated manifest).
- The 10 MiB test children exit naturally, so the test no longer proves `close` over `exit` specifically.
