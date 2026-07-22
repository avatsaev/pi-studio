# Task 001 — Protocol schemas for agent slash-command RPCs

- **Sprint:** sprint-037-agent-slash-commands
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Add the append-only Zod request/response schemas (and any shared data shapes) for the new
agent slash-command operations, so daemon, SDK, and CLI share one wire contract.

## Background / why
Pi built-in slash commands (`/session`, `/compact`, `/new`, …) are handled **only** in Pi's
interactive TUI. In `pi --mode rpc` they are NOT expanded by the `prompt` command — Pi's own
`docs/rpc.md` § Commands states: *"Built-in TUI commands (`/settings`, `/hotkeys`, etc.) are not
included. They are handled only in interactive mode and would not execute if sent via `prompt`."*
The daemon therefore currently forwards e.g. `/session` to the model as literal text. Each
built-in that has a structured Pi RPC equivalent must be exposed as its own Pi-Studio RPC instead.

11 built-ins map to existing Pi RPC commands; this sprint wires that subset server-side + SDK + CLI
(web-client deferred):

| Built-in | Pi RPC command (docs/rpc.md) |
|---|---|
| `/session` | `get_session_stats` (+ `get_state`) |
| `/compact` | `compact` (`customInstructions?`) |
| `/new` | `new_session` |
| `/resume` | `switch_session` (`sessionPath`) |
| `/fork` | `fork` (`entryId`) + `get_fork_messages` |
| `/clone` | `clone` |
| `/name` | `set_session_name` (`name`) |
| `/export` | `export_html` (`outputPath?`) |
| `/model` | `set_model` / `cycle_model` / `get_available_models` |
| `/copy` | `get_last_assistant_text` |

## Scope references
- `packages/protocol/AGENTS.md` (append-only rule; flat snake_case RPC convention)
- `clean-room-scope/architecture/websocket-protocol.md` § Session RPC envelopes
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
  §§ Compaction, Session, Model, Prompting

## What to build
Add to `packages/protocol/src` (matching the existing session-message schema module and its
`.passthrough()` + optional-field convention). All names flat snake_case, every request carries
`agentId` (except where noted). Suggested request/response pairs:

- `agent_session_stats_request` → `agent_session_stats_response`
  - resp data mirrors Pi `get_session_stats`: `sessionId`, `sessionFile`, message counts,
    `tokens {input,output,cacheRead,cacheWrite,total}`, `cost`, `contextUsage {tokens,contextWindow,percent}`
    (contextUsage + its tokens/percent may be null/omitted).
- `agent_compact_request` (`customInstructions?`) → `agent_compact_response`
  - resp data: `summary`, `firstKeptEntryId`, `tokensBefore`, `details?`.
- `agent_new_session_request` → `agent_new_session_response` (data `{cancelled}`).
- `agent_switch_session_request` (`sessionPath`) → response (data `{cancelled}`).
- `agent_fork_request` (`entryId`) → response (data `{text, cancelled}`).
- `agent_fork_messages_request` → response (data `{messages: {entryId, text}[]}`).
- `agent_clone_request` → response (data `{cancelled}`).
- `agent_set_session_name_request` (`name`) → response.
- `agent_export_html_request` (`outputPath?`) → response (data `{path}`).
- `agent_set_model_request` (`provider`, `modelId`) → response (full model object).
- `agent_cycle_model_request` → response (data `{model, thinkingLevel, isScoped}`; null model → single-model).
- `agent_last_assistant_text_request` → response (data `{text: string|null}`).

Note: model listing already exists (`get_available_models` via provider `listModels`); reuse the
existing agent-models RPC rather than adding a new one if present — verify against the current
protocol module before adding.

## Out of scope
- Any handler logic (task-003), provider methods (task-002), SDK/CLI (tasks 005/006).
- UI-only built-ins with no RPC (`/settings`, `/hotkeys`, `/changelog`, `/login`, `/logout`,
  `/reload`, `/scoped-models`, `/trust`, `/share`, `/quit`) — never added to the wire.

## Acceptance criteria
- [ ] New request/response schemas exist, all optional-field + `.passthrough()`, no existing field narrowed/removed.
- [ ] Names are flat snake_case and exported from the protocol package index.
- [ ] `npm run build:protocol` and `npm run typecheck` pass.

## Test / verification plan
- Build: `npm run build:protocol` succeeds.
- Tests: extend the protocol schema tests — a valid payload for each new request parses; an unknown
  extra field is tolerated (passthrough). `npx vitest run packages/protocol`.

## Notes
- Confirm whether an `agent`-scoped model-list/model-set RPC already exists before adding
  `agent_set_model_request`/`agent_cycle_model_request`; extend rather than duplicate.
- `get_state` fields overlap `get_session_stats`; `/session` can use stats alone — do not add a
  separate get_state RPC unless a caller needs `isStreaming`/`isCompacting`.
