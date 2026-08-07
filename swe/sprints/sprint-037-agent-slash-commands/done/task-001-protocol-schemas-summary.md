# Task 001 — Protocol schemas for agent slash-command RPCs — Summary

- **Sprint:** sprint-037-agent-slash-commands
- **Completed:** 2026-07-22
- **Status:** done

## What was implemented
Added 12 request/response schema pairs (24 new wire types) to `packages/protocol/src/messages.ts`
covering the Pi built-in slash commands that have a real Pi RPC equivalent: `/session`, `/compact`,
`/new`, `/resume`, `/fork` (+ fork-messages picker), `/clone`, `/name`, `/export`, `/model` (set +
cycle), `/copy`. All follow the existing flat-snake-case + `.passthrough()` + optional-field
convention (matching `agentRewindRequestSchema`/`fetchAgentTimelineRequestSchema` style), carry
`requestId` + `agentId` on requests, and are registered in `sessionMessageSchema`'s discriminated
union so they parse through the existing `session` envelope. Verified against the live Pi RPC
contract (`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`) that no agent-scoped
`set_model`/`cycle_model` RPC already existed in the protocol (only provider-level
`list_provider_models`/`list_provider_modes` did) before adding new ones.

Did NOT add schemas for the ~10 TUI-only built-ins (`/settings`, `/hotkeys`, `/changelog`,
`/login`, `/logout`, `/reload`, `/scoped-models`, `/trust`, `/share`, `/quit`) — Pi's own RPC docs
confirm these have no headless equivalent and must never be represented on the wire.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | modified — added 12 request/response schema pairs + shared `agentTokenUsageSchema`/`agentContextUsageSchema`; extended `sessionMessageSchema` union |
| `packages/protocol/src/session-messages.test.ts` | modified — added `describe("slash-command operations (sprint-037)")` with 15 new tests |

## How it satisfies the scope
- Task-001 acceptance: schemas are optional-field + `.passthrough()`, no existing field
  narrowed/removed (only additions to `messages.ts`); names are flat snake_case, exported from
  `packages/protocol/src/index.ts` (via the existing `export * from "./messages.js"` barrel — no
  index change needed).
- Confirmed no duplicate agent-scoped model RPC existed; new `agent_set_model_request` /
  `agent_cycle_model_request` are additive, distinct from provider-level `list_provider_models`.
- `get_state` fields overlap `get_session_stats`; per the task's own note, `/session` uses
  `agent_session_stats_*` alone — no separate `get_state` RPC added.

## Build & test results
```
$ npx tsc -b packages/protocol
(no output — success)

$ npx vitest run packages/protocol
 Test Files  9 passed (9)
      Tests  78 passed (78)
```

## Acceptance criteria
- [x] New request/response schemas exist, all optional-field + `.passthrough()`, no existing field narrowed/removed. (verified by `tsc -b` + full protocol suite green)
- [x] Names are flat snake_case and exported from the protocol package index. (barrel `export *` from `messages.js`)
- [x] `npm run build:protocol` and `npm run typecheck` pass. (`tsc -b packages/protocol` clean; full-workspace typecheck deferred to sprint-end verification since later tasks add more code)

## Follow-ups / TODO(verify)
- `agent_set_model_response`/`agent_set_model_request` payload for the model object is intentionally
  `z.unknown()`/passthrough since Pi's `Model<T>` shape is provider-specific and undocumented at the
  wire-schema level in `rpc.md` beyond example JSON — task-002 should tighten this once the Pi
  adapter's actual mapped shape is known, if useful.
- `agent_set_session_name_response` has no required payload fields (Pi's RPC docs show a bare
  `{"type":"response","command":"set_session_name","success":true}`) — `payload` is optional.
