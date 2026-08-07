# Task 002 — Include current model in `agent_session_stats` payload

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Ensure the `agent_session_stats_response` payload carries the session's **current** model id, so a
periodic stats poll is the authoritative, self-correcting source for the status-bar model segment
(covering `/model` cycle and cross-client changes that `agent_update` does not fully convey).

## Background / why
The status bar polls `agent_session_stats_request` for context usage (task-004). Reusing that same
poll for the model means the model segment stays correct regardless of *how* the model changed:
- `/model` **set** broadcasts `agent_update {model}` — instant, already handled.
- `/model` **cycle** broadcasts `agent_update` with **no** model value — the resolved model is only
  in the cycle RPC response to the caller, not to other clients.
- A change made by another client isn't otherwise reflected.

The Pi adapter already exposes the live model via `getRuntimeInfo().model`
(`packages/server/src/agent/providers/pi/agent.ts`), and the mock provider returns
`config.model ?? "mock-model"`. `get_session_stats` is Pi's stats RPC; whether its payload already
carries the model varies, so the daemon should attach the runtime model when the provider's own
stats don't.

## Scope references
- `clean-room-scope/features/agent-sessions.md` § Session stats / slash commands
- `clean-room-scope/features/agent-providers.md` § Runtime info
- `packages/server/AGENTS.md` (slash-command-operations, provider-contract)

## What to build
- **`packages/protocol/src/messages.ts`**: add `model: z.string().optional()` to
  `agentSessionStatsResponseSchema.payload` (already `.passthrough()` — additive only).
- **`packages/server/src/agent/slash-command-operations.ts`** (`handleSessionStats`): after calling
  `session.getSessionStats()`, if the returned payload has no `model`, fall back to
  `session.getRuntimeInfo?.().model` and merge it into the payload before responding. Do not
  overwrite a model the provider already reported.
- Confirm the provider contract's `getRuntimeInfo()` is available on the session at that call site
  (it is part of `AgentSession`); no contract change expected.

## Out of scope
- Emitting model as a stream event (poll-only by design — see sprint plan).
- Token/cost fields — those already exist on the stats payload (consumed in task-004).

## Acceptance criteria
- [ ] `agent_session_stats_response.payload.model` exists as an optional string; old payloads still
  validate.
- [ ] `handleSessionStats` returns a `model` when the provider stats omit it, derived from runtime
  info; a provider-supplied model is preserved as-is.
- [ ] `npm run build:protocol`, `npm run build:server`, `npm run typecheck` pass.

## Test / verification plan
- Server: extend `slash-command-ops.test.ts` — a session stub whose `getSessionStats()` omits
  `model` but whose `getRuntimeInfo()` returns `{model:"m9"}` yields a response payload with
  `model:"m9"`; a stub whose stats already include `model` keeps that value.
  `npx vitest run packages/server/src/agent/slash-command-ops.test.ts`.
- Protocol: `npx vitest run packages/protocol` — stats response parses with `model`.

## Notes
- Mock provider's `getRuntimeInfo().model` is `config.model ?? "mock-model"`, so mock sessions will
  report a stable model in the poll — useful for smoke-testing the bar without a live Pi daemon
  (though real context/token/cost values require the Pi provider).
