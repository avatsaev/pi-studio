# Task 001 — Summary: Pi provider: real thinking-level support + per-model level derivation

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done

## What was built

- **`packages/server/src/agent/providers/pi/thinking-levels.ts` (new, pure)** —
  `deriveThinkingLevels(model)` mirroring pi-ai's `getSupportedThinkingLevels`
  (`models.js:547-559`, verified): `!reasoning → ["off"]`; else the 7-level ladder filtered by
  `thinkingLevelMap` tristate (`null` removes; `xhigh`/`max` opt-in). Header documents the mirror
  + self-correction-at-set-time rationale; tolerates absent/malformed inputs (raw Pi objects are
  untyped records).
- **`provider-contract.ts`** — `AgentModelDefinition` gains `reasoning?: boolean` +
  `thinkingLevels?: string[]`; `ProviderRuntimeInfo` gains `thinkingLevel?: string` (effective
  level, distinct from the requested `thinkingOptionId`); `AgentSession` gains
  `listThinkingLevels?(): Promise<string[]>`.
- **`providers/pi/agent.ts`** — `setThinkingOption(id)` issues `set_thinking_level` then re-reads
  `get_state` (response carries no data; clamping silent); `setProviderModel` re-reads `get_state`
  after `set_model` (the verified trap: its response has no `thinkingLevel`); `cycleModel`
  captures the level from its own response; `discoverState()` also captures
  `state.thinkingLevel`; `getRuntimeInfo()` reports it; `listModels()` maps `reasoning` +
  `deriveThinkingLevels(rec)` per model. Shared `refreshThinkingLevel()` best-effort probe.
- **`providers/mock/mock-provider.ts`** — static `["off","low","medium","high"]` list;
  `setThinkingOption` clamps unknown picks to `off`; `listThinkingLevels` returns the list;
  runtime info reports the level; `listModels()` marks `mock-model` reasoning with the same
  list; `cycleModel` returns the current level.
- **Tests** — new `thinking-levels.test.ts` (6 derivation cases incl. malformed inputs);
  `pi-adapter.test.ts` fake transport gains `set_thinking_level` (silent clamp to `off`),
  `get_available_thinking_levels`, `get_state.thinkingLevel`, richer `get_available_models`
  (reasoning true/false + a `thinkingLevelMap` with a `null` hole and an opt-in `xhigh`), plus 6
  new session tests (clamped set, post-switch re-read, cycle capture, list, catalogue
  derivation); `mock-provider.test.ts` gains the thinking-surface test + updated catalogue/
  cycleModel expectations.

## Commands run (results)

- `npx vitest run packages/server/src/agent/providers` → **135 passed (135)**, 6 files.
- `npx tsc -b packages/server --force` → clean.
- `npx oxlint <changed files>` → 0 warnings (fixed one pre-existing `unicorn/no-array-reverse`
  in `mock-provider.ts` `getLastAssistantText` while in the file).
- `npx oxfmt --check <changed files>` → clean.

## Acceptance criteria

- [x] `setThinkingOption("high")` issues `set_thinking_level` and `getRuntimeInfo().thinkingLevel`
      reflects the clamped value (`off`) read back from `get_state`.
- [x] After `setProviderModel(...)`, `getRuntimeInfo().thinkingLevel` reflects the post-switch
      `get_state` value, not the stale pre-switch one.
- [x] `discoverState()` on create/resume populates `thinkingLevel`.
- [x] `listModels()` entries carry `reasoning` + `thinkingLevels`; derivation unit tests cover
      non-reasoning → `["off"]`, reasoning + no map → base 5, `null` hole removed, `xhigh`/`max`
      opt-in only.
- [x] Mock provider passes the same surface (set/list/runtime-info) with its static list.

## Docs synced

- `packages/server/AGENTS.md`: `list_provider_models` section (new per-model fields) + two new
  Pi-provider invariants (thinking-level cache/write-back probe; derivation mirror).

## Follow-ups

None. RPC registration, persistence, broadcast, and client work belong to tasks 002-005.
