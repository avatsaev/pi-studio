# Task 004 — SDK + CLI: compaction-length RPC timeout and typing

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** bugfix
- **Area:** packages/client, packages/cli
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal

A compaction that takes longer than 30 s no longer fails in the SDK or CLI, and callers see
`estimatedTokensAfter` in the typed payload.

## Context / why

`PiStudioClient.agent(id).compact()` and the CLI's `compactAgent` both use `DaemonClient`'s default
`rpcTimeoutMs` (30 s, `daemon-client.ts:109`). Summarising a large context routinely takes longer,
so the caller gets an `RpcTimeoutError` while the compaction is still running (G4). The socket
survives (`rpcTimeoutMs ≠ socket death`), but the UI would report a false failure.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Client SDK
- `packages/client/src/daemon-client.ts:185-200` — `request(type, params, timeoutMs?)`
- `packages/client/src/pistudio-client.ts:144-145` (interface), `:1058-1062` (implementation)
- `packages/client/src/test-support/scripted-daemon.ts:137-144` — compact fixture
- `packages/client/src/pistudio-client.test.ts:159-169`
- `packages/cli/src/agent-commands.ts:358-370` (`compactAgent`), `:782-791` (command)
- `packages/client/AGENTS.md`, `packages/cli/AGENTS.md`

## What to build

- `packages/client`: an exported `COMPACT_TIMEOUT_MS = 10 * 60_000`, passed as `timeoutMs` by
  `compact()`. Add `estimatedTokensAfter` to the scripted-daemon fixture payload.
- `packages/cli`: `compactAgent` passes the same constant. Import it from `@av-pi-studio/client`;
  do not duplicate the number.
- Docs: one line each in the client and CLI AGENTS.md, plus the CLI note that `agent compact` on a
  running agent now errors with `busy` (task-003's guard).

## Out of scope

- A general per-RPC timeout mechanism.

## Acceptance criteria

- [x] `compact()` issues its request with a 10-minute timeout (assert the timer value via the fake,
      or a fake-timers test that a 31 s delay still resolves).
- [x] `compactAgent` uses the same constant.
- [x] Typed payload exposes `estimatedTokensAfter`.

## Test / verification plan

- Tests: extend `pistudio-client.test.ts` and `packages/cli/src/agent-commands.test.ts:351-361`.
- Run: `npx vitest run packages/client packages/cli`, then `npm run build:client` and
  `npm run build:cli`.
