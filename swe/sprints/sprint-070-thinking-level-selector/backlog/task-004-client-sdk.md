# Task 004 — Client SDK: `setThinking` / `listThinkingLevels` + typed model/default additions

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** backlog
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-002, task-003

## Goal

Typed SDK facade for the new wire surface, so no client touches raw request names
(SDK-only networking is a repo invariant).

## Context / why

`PiStudioClient` is the only sanctioned network path for the web client. The `agent(id)` handle
already exposes `setModel`/`update`; thinking gets the same treatment, plus typing for the three
extended payloads task-001/003 added to existing responses.

## Scope references

- `swe/features/thinking-level-selector.md` § Public contract
- `packages/client/src/pistudio-client.ts` (`ProviderModel:171`,
  `ResolveDefaultModelResponse:191-203`, `AgentHandle.update:112-119`, providers actions ~:1072)
- `packages/client/src/test-support/scripted-daemon.ts` (fixture additions)

## What to build

- `agent(id).setThinking(level: string): Promise<AgentSetThinkingResponse>` →
  `agent_set_thinking_request`; response typed `{ agentId, level }` with a doc comment that
  `level` is the **effective** (possibly clamped) value.
- `agent(id).listThinkingLevels(): Promise<AgentThinkingLevelsResponse>` →
  `agent_thinking_levels_request`; typed `{ agentId, levels: string[] }`.
- `ProviderModel` gains optional `reasoning?: boolean`, `thinkingLevels?: string[]`;
  `ResolveDefaultModelResponse` gains optional `thinkingLevel?: string` — doc comments pointing at
  the derivation/write-back semantics in the spec.
- Capability note: consumers gate on the `thinkingLevels` server feature flag (document on the
  method, matching how other gated surfaces are annotated).
- `scripted-daemon.ts` learns both request types so client tests can script them.

## Out of scope

- Web-client consumption (task-005).

## Acceptance criteria

- [ ] Both methods round-trip against the scripted daemon with typed responses.
- [ ] Existing `ProviderModel` consumers compile unchanged (fields optional).

## Test / verification plan

- Unit: extend the client SDK tests using `scripted-daemon.ts`.
- Focused run: `npx vitest run packages/client` — pass.
- Typecheck `npx tsc -b --force` clean; scoped lint/fmt.
