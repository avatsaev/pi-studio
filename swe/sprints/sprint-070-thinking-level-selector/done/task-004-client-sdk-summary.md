# Task 004 — Summary: Client SDK `setThinking` / `listThinkingLevels` + typed additions

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done

## What was built

- `packages/client/src/pistudio-client.ts`:
  - `AgentHandle.setThinking(level): Promise<AgentSetThinkingResponse["payload"]>` →
    `agent_set_thinking_request`; doc comment: response `level` is the EFFECTIVE (possibly
    Pi-clamped) value.
  - `AgentHandle.listThinkingLevels(): Promise<AgentThinkingLevelsResponse["payload"]>` →
    `agent_thinking_levels_request`.
  - Both annotated: gate on the `thinkingLevels` server feature flag; drafts read the model
    catalogue instead of `listThinkingLevels`.
  - `ProviderModel` gains `reasoning?: boolean` + `thinkingLevels?: string[]` (derivation
    semantics documented); `ResolveDefaultModelResponse` gains `thinkingLevel?: string`.
- `packages/client/src/test-support/scripted-daemon.ts`: both request types scripted —
  `agent_set_thinking_request` "clamps" every pick to `medium` so tests assert the response,
  not the request; `agent_thinking_levels_request` answers a 4-level list.
- Tests: `pistudio-client.test.ts` gains two round-trip tests (setThinking surfaces the
  clamped `medium` while the request carried `high`; listThinkingLevels returns the levels
  payload with the correlated agentId).

## Commands run (results)

- `npx vitest run packages/client` → **161 passed (161)**, 8 files.
- `npx tsc -b --force` → clean.
- `npx oxlint` / `npx oxfmt --check` on changed files → clean.

## Acceptance criteria

- [x] Both methods round-trip against the scripted daemon with typed responses.
- [x] Existing `ProviderModel` consumers compile unchanged (fields optional — full typecheck
      green).

## Docs synced

- `packages/client/AGENTS.md`: agent-handle table rows for both methods + `ProviderModel`/
  `ResolveDefaultModelResponse` additions.

## Follow-ups

None. Web-client consumption is task-005.
