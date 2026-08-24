# Task 002 — Protocol schemas + `agent_set_thinking` / `agent_thinking_levels` RPCs

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol, packages/server (daemon RPC surface)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

The wire surface: append-only protocol schemas, the `thinkingLevels` server feature flag, and two
daemon handlers — a **complete** set path (apply → read effective → persist → broadcast → respond)
and a live-session levels query.

## Context / why

Mirrors the `agent_set_model` family (flat snake_case, real `messages.ts` schemas — that family has
schemas, per `session-messages.test.ts`). The set handler MUST include the materialized-draft
branch: a draft has no live session, and routing it to `requireSession` throws an rpc_error the
web client swallows — the exact silently-lost-pick bug sprint-043's corrections fixed for model
(`slash-command-operations.ts:253-262` doc comment). The response carries the **effective**
(possibly clamped) level so the caller never has to guess.

## Scope references

- `swe/features/thinking-level-selector.md` § Public contract, § Clamp write-back
- `packages/protocol/src/messages.ts` (+ `session-messages.test.ts`), feature-flag declaration
  (precedent: `extensionUi` — see `packages/protocol/AGENTS.md`)
- `packages/server/src/agent/slash-command-operations.ts` (`persistModel:239`, `handleSetModel:263`,
  `broadcastAgentUpdate` — the shapes to mirror)
- `packages/server/src/daemon/bootstrap.ts` + `dev-bootstrap.ts` (registration)

## What to build

- **protocol:** `agentSetThinkingRequestSchema { agentId, level }` /
  `agentSetThinkingResponseSchema { agentId, level }`,
  `agentThinkingLevelsRequestSchema { agentId }` /
  `agentThinkingLevelsResponseSchema { agentId, levels: string[] }` — optional-field,
  `.passthrough()`, added to the session-message union; `thinkingLevels` server feature flag.
- **server** (`slash-command-operations.ts` or sibling): `persistThinking(agentId, level)`
  (mirror of `persistModel` — merge into `record.config.thinkingOptionId` via
  `manager.updateRecord`); `handleSetThinking`:
  - draft branch (`!managed.session`): `persistThinking` + `broadcastAgentUpdate(thinkingLevel)` +
    respond with the requested level;
  - live branch: `setThinkingOption` (throw `unsupported` when absent) → effective level from
    `getRuntimeInfo().thinkingLevel` → `persistThinking(effective)` → broadcast → respond with
    effective.
  `handleThinkingLevels`: `requireSession` → `listThinkingLevels()` (throw `unsupported` when
  absent) → respond. Register both in `bootstrap.ts` AND `dev-bootstrap.ts`.

## Out of scope

- Replay, model-change write-back, `list_agents`, `update_agent` routing, `resolve_default_model`
  (task-003). Client SDK typing (task-004).

## Acceptance criteria

- [ ] Set on a live session returns the clamped level and persists that same value to the record.
- [ ] Set on a materialized draft (no session) persists + broadcasts + responds — no throw.
- [ ] Levels query on a live session returns the provider's list; on a draft it rpc_errors.
- [ ] Both handlers registered in production AND dev bootstrap; feature flag advertised.
- [ ] Protocol schemas parse round-trip in `session-messages.test.ts` additions; nothing removed
      or narrowed.

## Test / verification plan

- Unit: extend `slash-command-ops.test.ts` (or sibling) — live set with clamping stub, draft set,
  unsupported provider, levels query; protocol schema tests.
- Focused run: `npx vitest run packages/protocol packages/server/src/agent` — pass.
- Typecheck `npx tsc -b --force` clean; scoped lint/fmt.

## Notes

- Broadcast field name is `thinkingLevel` (effective), never `thinkingOptionId` (requested) — the
  wire always speaks truth, config stores the same truth after write-back.
