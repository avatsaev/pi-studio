# Task 001 — Protocol schemas for turn steering

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Add the append-only Zod request/response schemas for injecting a message into a **live** agent
turn (`steer` / `follow_up`), plus a new `queue_update` stream-event variant, so daemon, SDK, CLI,
and web-client share one wire contract.

## Background / why
Pi's `pi --mode rpc` protocol supports **steering** a running turn (its own TUI does this): while
the agent is mid-turn you can inject additional instructions without waiting for it to finish.
Pi's `docs/rpc.md` § Prompting defines three mechanisms:

- **`steer`** — queue a message delivered **after the current assistant turn finishes its tool
  calls, before the next LLM call** (mid-task redirect). Extension commands not allowed here.
- **`follow_up`** — queue a message delivered **only after the agent fully stops** (enqueue-for-after).
- **`prompt` with `streamingBehavior: "steer" | "followUp"`** — a plain `prompt` sent mid-stream
  errors unless one of these is set.

Pi also exposes `set_steering_mode` (`all` | `one-at-a-time`, default one-at-a-time),
`set_follow_up_mode`, and emits a **`queue_update`** event (`{steering: string[], followUp:
string[]}`) whenever the pending queue changes. Today the daemon has no wire path for any of this
and drops `queue_update`.

This sprint wires **steer + follow_up** end-to-end via **dedicated fire-and-forget RPCs** (like
`interrupt_agent`), NOT by overloading `send_agent_prompt`. `set_steering_mode`/`set_follow_up_mode`
are out of scope (default one-at-a-time is used).

## Scope references
- `packages/protocol/AGENTS.md` (append-only rule; flat snake_case RPC convention)
- `clean-room-scope/architecture/websocket-protocol.md` § Session RPC envelopes
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
  §§ Prompting (`prompt`/`steer`/`follow_up`), State (`get_state`), Events (`queue_update`)

## What to build
Add to `packages/protocol/src/messages.ts` (matching the existing session-message schema module and
its `.passthrough()` + optional-field convention). All names flat snake_case; every request carries
`agentId`.

- `steer_agent_request` (`agentId`, `message`, `images?`, `clientMessageId?`) →
  `steer_agent_response` (`agentId`, `ok: boolean`).
- `follow_up_agent_request` (`agentId`, `message`, `images?`, `clientMessageId?`) →
  `follow_up_agent_response` (`agentId`, `ok: boolean`).
- Extend `agentStreamEventSchema` with a `queue_update` variant:
  `{ kind: "queue_update", steering?: string[], followUp?: string[] }`.
- Register all four request/response schemas in `sessionMessageSchema` and export from the package
  index.
- Add an optional additive capability flag `supportsSteering?: boolean` to
  `agentCapabilityFlagsSchema` (`provider-manifest.ts`), mirroring the existing optional rewind flags.

## Out of scope
- Provider methods (task-002), daemon handlers (task-003), SDK/CLI (task-005/006), web-client
  (task-007).
- `set_steering_mode` / `set_follow_up_mode` RPCs — default one-at-a-time; not exposed.
- `streamingBehavior` overload on `send_agent_prompt` — dedicated RPCs only.

## Acceptance criteria
- [ ] New request/response schemas + the `queue_update` event variant exist, all optional-field +
  `.passthrough()`, no existing field narrowed/removed.
- [ ] `supportsSteering?` added as an optional boolean, old data still validates.
- [ ] Names are flat snake_case and exported from the protocol package index.
- [ ] `npm run build:protocol` and `npm run typecheck` pass.

## Test / verification plan
- Build: `npm run build:protocol` succeeds.
- Tests: extend `session-messages.test.ts` — a valid `steer_agent_request` / `follow_up_agent_request`
  parses; the `queue_update` event kind discriminates; unknown extra fields tolerated (passthrough).
  Extend `provider-manifest.test.ts` for the optional flag. `npx vitest run packages/protocol`.

## Notes
- `queue_update` carries message **strings**, not ids — downstream (web-client badge) cannot
  correlate a queue entry back to a specific optimistic row by id; plan for best-effort text-based
  correlation there (task-007), not here.
