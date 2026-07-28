# Task 004 — Mock support, end-to-end verification, docs sync

- **Sprint:** sprint-040-agent-command-discovery
- **Status:** in_progress
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
Give the `mock` provider a deterministic `listCommands()` so the daemon handler is exercisable
without a real `pi` binary, run the full verification, and sync the docs.

## Background / why
The daemon handler (task-003) resolves a live `AgentSession` and calls `listCommands()`. To test
the happy path end-to-end without spawning `pi`, the mock session needs a deterministic
implementation. Keeping at least one *other* optional method omitted on the mock preserves coverage
of the "provider method absent → `rpc_error`" path from task-003. Docs are a same-change deliverable
per the repo's docs-sync rule.

## Scope references
- `packages/server/src/agent/providers/mock/mock-provider.ts` (mock `AgentSession`; existing
  deterministic slash-command stubs from sprint-037)
- `packages/server/src/agent/provider-contract.ts` (enriched `AgentCommandDefinition` from task-002)
- `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md` (RPC/slash-command listings)
- `packages/server/AGENTS.md` § mock provider (dependency-free smoke testing)

## What to build
1. Implement `listCommands()` on the mock `AgentSession` returning a fixed synthetic list covering
   all three sources — e.g. one `extension` (project scope), one `prompt` (project), one `skill`
   (user) — with stable `name`/`description`/`source`/`scope`/`path` (no timestamps/random).
2. Docs sync:
   - `packages/protocol/AGENTS.md` — add `agent_list_commands_request`/`_response` to the RPC/
     session-message listing.
   - `packages/server/AGENTS.md` — add the handler to the slash-command-operations listing and note
     it surfaces Pi `get_commands` (extension/prompt/skill discovery).
   - Root `AGENTS.md` — only if it enumerates slash commands (verify; likely no change).

## Out of scope
- SDK facade, CLI, MCP mirror, web-client (deferred).
- Real Pi behavior (covered by the adapter unit test in task-002).

## Acceptance criteria
- [ ] Mock `listCommands()` returns a deterministic multi-source list.
- [ ] At least one optional method remains omitted on the mock so the unsupported→`rpc_error` path
      stays covered.
- [ ] Docs updated (protocol + server AGENTS.md) truthfully; no aspirational behavior documented.
- [ ] `npm run build`, `npm run typecheck`, and the server + protocol Vitest suites pass.

## Test / verification plan
- Tests: extend `packages/server/src/agent/providers/mock/mock-provider.test.ts` asserting the
  deterministic output; the task-003 handler suite consumes the mock for the happy path.
- Full check: `npm run build:server` + `npx vitest run packages/server packages/protocol`.
- Optional live smoke (only if a real `pi` binary is on PATH): start the daemon, create a session
  in a cwd containing a `.pi/agent/prompts/*.md`, issue `agent_list_commands_request`, confirm the
  template appears with `source: "prompt"`. Not required for sign-off — the adapter + mock tests are
  the proof.

## Notes
- Keep mock outputs stable so assertions don't flake.
- This sprint is server-only; a client/SDK/CLI/UI discovery surface is a deliberate follow-up.
