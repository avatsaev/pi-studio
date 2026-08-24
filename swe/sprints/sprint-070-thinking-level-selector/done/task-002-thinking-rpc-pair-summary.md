# Task 002 — Summary: Protocol schemas + `agent_set_thinking` / `agent_thinking_levels` RPC pair

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done

## What was built

- **`packages/protocol/src/messages.ts`** — four new append-only schemas:
  `agentSetThinkingRequestSchema`/`-ResponseSchema` (request: `agentId` + `level` (dynamic
  string); response payload: `agentId` + `level` = the EFFECTIVE level) and
  `agentThinkingLevelsRequestSchema`/`-ResponseSchema` (`levels: string[]`), all registered in
  `sessionMessageSchema`.
- **`packages/protocol/src/client-capabilities.ts`** — `SERVER_FEATURES.thinkingLevels` +
  `COMPAT` entry (added 0.0.0, removeBy TBD), auto-advertised in `server_info.features` via
  `ws-server.ts`.
- **`packages/server/src/agent/slash-command-operations.ts`** — `handleSetThinking` mirroring
  `handleSetModel`'s two-branch shape: deferred draft → `persistThinking` (new helper: writes
  `config.thinkingOptionId` via `updateRecord`, same write first-spawn replay reads) +
  `agent_update` broadcast with `thinkingLevel`; live session → `setThinkingOption`, then
  answer/persist/broadcast `getRuntimeInfo().thinkingLevel ?? requested` (effective, never
  requested); missing `setThinkingOption` → `unsupported(...)` → `rpc_error`.
  `handleThinkingLevels`: `requireSession` (drafts are a legitimate `rpc_error` — they answer
  from the catalogue client-side), delegates to `listThinkingLevels()`. Both registered in
  `registerHandlers`, which both bootstraps call.
- **Tests** — `session-messages.test.ts`: two round-trip tests + four union-registry entries
  (also removed six pre-existing unused schema imports in the file to keep it lint-clean);
  `client-capabilities.test.ts`: flag enumeration updated (`toSorted` fix included);
  `slash-command-ops.test.ts`: six new tests (live set → clamped effective level answered,
  persisted, broadcast; draft set → pin + broadcast + respond, no throw; unsupported →
  `/does not support/`; live list delegates; draft list → `/no live session/`; unknown agent →
  `/unknown agent/`). `sessionStub` hoisted to module scope (lint).

## Commands run (results)

- `npx vitest run packages/protocol packages/server/src/agent` → **472 passed (472)**, 36 files.
- `npx tsc -b --force` → clean.
- `npx oxlint <changed files>` → 0 warnings.
- `npx oxfmt --check <changed files>` → clean.

## Acceptance criteria

- [x] `agent_set_thinking_request` on a live session applies via `setThinkingOption` and
      answers/broadcasts the clamped effective level; the record's `config.thinkingOptionId`
      holds the effective value.
- [x] Same request on a still-unspawned deferred draft persists + broadcasts + responds (no
      throw), for first-spawn replay.
- [x] `agent_thinking_levels_request` delegates to `listThinkingLevels()`; draft → `rpc_error`
      "no live session".
- [x] Both bootstraps register the handlers (shared `registerHandlers`), and the daemon
      advertises `thinkingLevels` in `server_info.features`.

## Docs synced

- `packages/protocol/AGENTS.md` (SERVER_FEATURES row), `packages/server/AGENTS.md` (source
  layout row + new thinking-pair invariant + slash-command RPC list), root `AGENTS.md`
  (protocol-overview bullet).

## Follow-ups

None. Persistence chain (replay, clamp write-back, projections) is task-003.
