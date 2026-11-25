# Task 004 — Workbench: the 30-minute request timeout goes — Summary

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`connection-store.ts` no longer sets `rpcTimeoutMs` (the SDK default of 30 s applies; `DEFAULT_RPC_TIMEOUT_MS` is exported from `daemon-client.ts`). Named SDK timeouts, each used by its facade method: `SESSION_START_TIMEOUT_MS` (150 s: resume, importAgentSession, fork, forkMessages, clone, listCommands, which can spawn Pi first), `PI_COMMAND_TIMEOUT_MS` (90 s: interrupt, newSession, switchSession), `EXTENSION_PACKS_SYNC_TIMEOUT_MS` (15 min, still overridable by `opts.timeoutMs`), `WORKTREE_TIMEOUT_MS` (10 min; only the CLI sends worktree requests). No constant for provider login (it answers at once with a flow id) or for update apply (it returns as soon as the update starts); compact and skills keep theirs. A table-driven test pins method to timeout.

## Files changed
`packages/client/src/{pistudio-client,daemon-client}.ts`, `pistudio-client.test.ts`, `packages/workbench/src/lib/connection/connection-store.ts` (+test); docs `packages/client/AGENTS.md` ("Per-request timeouts"), `packages/workbench/AGENTS.md`, `swe/features/desktop-client-protocol-followups-2.md`.

## Build & test results
```
npx vitest run packages/client packages/workbench -> 165 files, 2348 passed; build:client, build:workbench (check-dist) OK; oxfmt/oxlint clean
```

## Acceptance criteria
- [x] No 30-minute value is left in the workbench
- [x] Each long request has a named timeout and a test; a two-minute provider login does not time out (fake timers)
- [x] A daemon that never answers fails at 30 s and the socket stays open

## Follow-ups / TODO(verify)
- The values are my reading of the daemon's bounds (Pi request 60 s, install 180 s per entry), not measured.
- The CLI keeps its own timeouts (`EXTENSIONS_SYNC_TIMEOUT_MS`, raw requests for import, resume, interrupt, worktrees); task-002 was told which constants to use.
- The 30-minute sentence in `docs/daemon-audit-handoff.md` is stale (updated at the close of M4).
