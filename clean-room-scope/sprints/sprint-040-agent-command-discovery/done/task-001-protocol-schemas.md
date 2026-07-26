# Task 001 — Protocol schemas for agent command-discovery RPC

- **Sprint:** sprint-040-agent-command-discovery
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Add the append-only Zod request/response schemas for a per-session **command discovery** RPC that
surfaces Pi's `get_commands` output, so daemon (and later SDK/CLI/UI) share one wire contract.

## Background / why
Pi dynamically registers three kinds of user/project-authored commands, all invokable via `/name`
in a `prompt`: **extension commands** (`pi.registerCommand()` in `.pi/agent/extensions/*.ts`),
**prompt templates** (`.pi/agent/prompts/*.md`), and **skills** (`.pi/agent/skills/<name>/SKILL.md`,
invoked as `/skill:<name>`). Pi's `docs/rpc.md` § `get_commands` returns them with per-command
metadata: `name`, `description?`, `source` (`extension`|`prompt`|`skill`), and a `sourceInfo`
object (`scope: user|project|temporary`, `path`, …).

This set is **disjoint** from the 11 built-in slash commands wired in sprint-037 (`/session`,
`/compact`, … — those are Pi built-ins with dedicated structured RPCs and are NOT part of
`get_commands`). Today the daemon exposes **no** discovery surface: a typed `/mycommand` still
executes because Pi expands it inside `pi --mode rpc`, but there is no way to enumerate what
commands/skills/templates a given session (cwd-scoped, since project-level commands live under the
session's working dir) actually has, their descriptions, or their scope/origin. This RPC closes
that gap.

## Scope references
- `packages/protocol/AGENTS.md` (append-only rule; flat snake_case RPC convention)
- `packages/protocol/src/messages.ts` (existing `agent_session_stats_request`/`_response` pair as
  the exact template; the `sessionMessageSchema` discriminated union at the module tail)
- `clean-room-scope/architecture/websocket-protocol.md` § Session RPC envelopes
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` § Commands →
  `get_commands`; `dist/modes/rpc/rpc-types.d.ts` (`RpcSlashCommand`);
  `dist/core/source-info.d.ts` (`SourceInfo`, `SourceScope`)

## What to build
Add to `packages/protocol/src/messages.ts` (matching the session-message module's `.passthrough()`
+ optional-field convention; flat snake_case; every request carries `requestId` + `agentId`):

- `agent_list_commands_request` → `agent_list_commands_response`
  - request: `{ type, requestId, agentId }`.
  - response: `{ type, requestId, payload: { commands: Command[] } }`, where each `Command` is a
    `.passthrough()` object: `name: string`, `id?: string`, `description?: string`,
    `source?: "extension" | "prompt" | "skill"`, `scope?: "user" | "project" | "temporary"`,
    `path?: string`. All command fields except `name` optional (append-only tolerance).

Export the inferred TS types, and **add both schemas to the `sessionMessageSchema`
discriminated union** (the block near the module tail) — otherwise the message falls through to
the structural base and skips strict validation.

## Out of scope
- Any handler logic (task-003), provider methods (task-002), mock/verification (task-004).
- SDK facade, CLI, MCP mirror, web-client — all deferred (separate follow-up sprint if wanted).
- The other audit gaps (`agent_settled`/`willRetry`, thinking-level control, permission bridge) —
  unrelated, not in this sprint.

## Acceptance criteria
- [ ] `agent_list_commands_request`/`_response` schemas exist, optional-field + `.passthrough()`,
      no existing field narrowed/removed.
- [ ] Both are members of `sessionMessageSchema` and exported from the protocol package index.
- [ ] Names are flat snake_case.
- [ ] `npm run build:protocol` and `npm run typecheck` pass.

## Test / verification plan
- Build: `npm run build:protocol` succeeds.
- Tests: extend `packages/protocol/src/session-messages.test.ts` — assert the request requires
  `agentId`, the response accepts a populated `commands` array (all field kinds), and an unknown
  extra field is tolerated (passthrough). `npx vitest run packages/protocol`.

## Notes
- Mirror the `agent_session_stats_*` schema shape exactly (that pair is the closest precedent).
- Keep `name` required and `id` optional; the adapter (task-002) mirrors `name` into `id` for
  callers that key on a stable id, without forcing every future producer to supply one.
