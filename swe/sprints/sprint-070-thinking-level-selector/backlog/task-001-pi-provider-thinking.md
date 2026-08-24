# Task 001 — Pi provider: real thinking-level support + per-model level derivation

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent/providers)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Make `setThinkingOption` real for the `pi` provider, expose the effective level and the available
levels, and ship per-model `reasoning`/`thinkingLevels` in the model catalogue — the provider-layer
foundation everything else in this sprint consumes.

## Context / why

`AgentSession.setThinkingOption?` is declared (`provider-contract.ts:227`) and called via `?.`
(`session-operations.ts:163`) but implemented by **nobody** — `update_agent_request` with
`thinkingOptionId` persists config and silently applies nothing. Pi's RPC side is fully capable
(`set_thinking_level`, `get_available_thinking_levels`, `get_state.thinkingLevel`). One verified
trap drives the design: **`set_model`'s response does NOT carry `thinkingLevel`** (only
`cycle_model`'s does), yet a model switch is exactly when Pi clamps — so the adapter must re-read
`get_state` after a model change or the daemon reports a level the agent is not using.

## Scope references

- `swe/features/thinking-level-selector.md` § Ground truth, § Behavior (clamp write-back, discovery)
- `packages/server/src/agent/provider-contract.ts` (`AgentSession.setThinkingOption`, new
  `listThinkingLevels?`, `ProviderRuntimeInfo.thinkingLevel:107`, `AgentModelDefinition:28`)
- `packages/server/src/agent/providers/pi/agent.ts` (`discoverState:218`, `getRuntimeInfo:329`,
  `setProviderModel:482`, `cycleModel`, `listModels:639`)
- `packages/server/src/agent/providers/mock/mock-provider.ts` (`listModels:450`)

## What to build

- **`providers/pi/thinking-levels.ts` (new, pure)** — `deriveThinkingLevels(model): string[]`
  mirroring pi-ai's `getSupportedThinkingLevels` (verified `models.js:548-559`; NOT importable —
  nested transitive dep): `!reasoning → ["off"]`; else filter
  `["off","minimal","low","medium","high","xhigh","max"]` by `thinkingLevelMap` tristate (`null`
  removes; `xhigh`/`max` require a non-null entry; others included unless `null`). Document the
  mirror + self-correction-at-set-time rationale in the header.
- **`providers/pi/agent.ts`:**
  - `setThinkingOption(id)` → `set_thinking_level {level: id}`, then re-read `get_state` and store
    `this.thinkingLevel` (response carries no data; clamping is silent).
  - `listThinkingLevels()` → `get_available_thinking_levels`, returns `data.levels` (fallback `[]`).
  - `discoverState()` also captures `state.thinkingLevel`.
  - `setProviderModel()` re-reads `get_state` after `set_model` and updates `this.thinkingLevel`
    (the trap above). `cycleModel()` captures `thinkingLevel` from its own response (already there).
  - `getRuntimeInfo()` reports `thinkingLevel`.
  - `listModels()` mapping additionally carries `reasoning` (boolean passthrough) and
    `thinkingLevels: deriveThinkingLevels(rec)` per model; extend `AgentModelDefinition` with both
    optional fields.
- **`providers/mock/mock-provider.ts`:** `setThinkingOption` stores the level (clamp to a static
  `["off","low","medium","high"]`, initial `"off"`), `listThinkingLevels()` returns that list,
  runtime info reports the level, `listModels()` marks `mock-model` `reasoning: true` with the same
  `thinkingLevels` — so the dev daemon exercises the full path.

## Out of scope

- Any RPC registration, persistence, broadcast, or client work (tasks 002-005).

## Acceptance criteria

- [ ] `setThinkingOption("high")` issues `set_thinking_level` and `getRuntimeInfo().thinkingLevel`
      reflects the **clamped** value read back from `get_state` (test with a fake clamping to `"off"`).
- [ ] After `setProviderModel(...)`, `getRuntimeInfo().thinkingLevel` reflects the post-switch
      `get_state` value, not a stale pre-switch one.
- [ ] `discoverState()` on create/resume populates `thinkingLevel`.
- [ ] `listModels()` entries carry `reasoning` + `thinkingLevels`; derivation unit tests cover:
      non-reasoning → `["off"]`; reasoning + no map → base 5; `null` hole removed; `xhigh`/`max`
      opt-in only with non-null entries.
- [ ] Mock provider passes the same surface (set/list/runtime-info) with its static list.

## Test / verification plan

- Unit: `providers/pi/thinking-levels.test.ts` (derivation table above);
  extend `providers/pi/pi-adapter.test.ts` (fake transport gains `set_thinking_level` /
  `get_available_thinking_levels` / `get_state.thinkingLevel`) and
  `providers/mock/mock-provider.test.ts`.
- Focused run: `npx vitest run packages/server/src/agent/providers` — all pass.
- Typecheck: `npx tsc -b packages/server --force` clean. Lint/fmt scoped to changed files.

## Notes

- `dedupeByModelKey`-style defensiveness applies: derivation must tolerate absent/malformed
  `thinkingLevelMap` (raw Pi objects are untyped records here).
- Do NOT narrow the level type to an enum anywhere — dynamic strings per repo convention
  (`messages.ts:133-135` comment).
