# Task 003 — Persistence chain: replay, clamp write-back on model change, projection, default

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent lifecycle + daemon projections)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal

Make the level **survive and converge everywhere**: replay on spawn/resume, effective-level
write-back when a model change clamps, `list_agents` projection, `update_agent_request` routed
through the same helper, and the draft default level.

## Context / why

This is the user's core requirement ("memorized across reloads and resumes for each session").
Four links: write (task-002) → **replay** → **reload** → **converge**. Two correctness rules from
the review: (1) replay order is model THEN thinking — Pi clamps thinking against the model, so
thinking-first gets overwritten; (2) every model change must write back and broadcast the
effective level, or `record.config.thinkingOptionId` goes stale and dead-session `list_agents`
lies (pin `max` → switch to non-reasoning model → truth is `off`, record says `max`).

## Scope references

- `swe/features/thinking-level-selector.md` § Persistence chain, § Clamp write-back, § Edge cases
- `packages/server/src/agent/agent-service.ts` (`spawnOrResumeSession` replay at :99-101)
- `packages/server/src/agent/slash-command-operations.ts` (`handleSetModel:263`,
  `handleCycleModel:288`)
- `packages/server/src/agent/session-operations.ts` (`handleUpdate:141`, thinking branch :162-164)
- `packages/server/src/daemon/bootstrap.ts` (`list_agents:309-323`, `resolve_default_model:367+`)
  + `dev-bootstrap.ts` equivalents
- `packages/server/src/agent/providers/pi/agent.ts` (`resolveDefaultModel:668+`)

## What to build

- **Replay** (`agent-service.ts` `spawnOrResumeSession`): after the existing
  `setProviderModel` replay, `if (record.config?.thinkingOptionId) await
  session.setThinkingOption?.(record.config.thinkingOptionId)`. Skip entirely when undefined —
  never clobber Pi's own restored/default level with a synthetic value.
- **Model-change write-back** (`handleSetModel`, `handleCycleModel`): after the model persist,
  read `session.getRuntimeInfo().thinkingLevel` (task-001 keeps it fresh post-switch), and when
  defined `persistThinking` + include `thinkingLevel` in the existing `broadcastAgentUpdate` call.
- **Single write path** (`session-operations.ts` `handleUpdate`): the `thinkingOptionId` branch
  routes through the same apply-then-effective-then-persist logic as `handleSetThinking` (extract
  or call the task-002 helper) and the closing `agent_update` broadcast carries the effective
  level — the CLI's `agent update --thinking` becomes coherent with the dedicated RPC, not a
  second divergent semantics.
- **Projection** (`bootstrap.ts` + `dev-bootstrap.ts` `list_agents`):
  `thinkingLevel: m.session?.getRuntimeInfo().thinkingLevel ?? m.record.config?.thinkingOptionId`
  (live wins over pinned, same shape as `model` one line above).
- **Draft default** (`resolveDefaultModel` in the pi adapter + both bootstrap handlers +
  `defaultModelCache`): the `--no-session get_state` already receives `thinkingLevel`; carry it
  through the cache into `resolve_default_model`'s response as optional `thinkingLevel`.

## Out of scope

- Client SDK typing (task-004), web-client store/UI (task-005).

## Acceptance criteria

- [ ] `spawnOrResumeSession` replays thinking strictly AFTER model (unit test asserts call order),
      and not at all when `config.thinkingOptionId` is undefined.
- [ ] Live model switch that clamps: record's `thinkingOptionId` equals the clamped level afterward
      and the broadcast carried it (stubbed session whose runtime info flips to `"off"` post-switch).
- [ ] `update_agent_request` with `thinkingOptionId` on a live session applies + persists effective
      + broadcasts — same observable behavior as `agent_set_thinking_request`.
- [ ] `list_agents` reports the live level when a session exists, the pinned one otherwise.
- [ ] `resolve_default_model` response includes `thinkingLevel` when Pi reports one.

## Test / verification plan

- Unit: extend `session-ops.test.ts` (replay order — the existing `setProviderModelCalls` pattern
  at :277-338 is the template), `slash-command-ops.test.ts` (write-back), a `list_agents`
  projection test if the harness allows.
- Focused run: `npx vitest run packages/server/src/agent` — pass.
- Typecheck `npx tsc -b --force` clean; scoped lint/fmt.

## Notes

- Resume semantics: Pi restores its own level from the session JSONL; replay overrides it
  unconditionally — identical to model replay. With write-back, config and JSONL cannot diverge.
  State this in the code comment at the replay site.
