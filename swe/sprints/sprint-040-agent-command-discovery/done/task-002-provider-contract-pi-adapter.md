# Task 002 — Enrich command-definition contract + implement Pi `listCommands`

- **Sprint:** sprint-040-agent-command-discovery
- **Status:** in_progress
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Grow the provider-neutral `AgentCommandDefinition` to carry discovery metadata, and implement the
already-declared but unimplemented `AgentSession.listCommands?()` in the Pi adapter by calling Pi's
`get_commands` RPC over the live session transport.

## Background / why
`AgentSession.listCommands?(): Promise<AgentCommandDefinition[]>` is **already declared** in
`provider-contract.ts` (optional-capability list) but **no provider implements it** and no RPC
exposes it — a dangling optional. `AgentCommandDefinition` is currently `{ id; label?; description? }`,
too thin for `get_commands`, which also returns `source` (extension/prompt/skill) and `sourceInfo`
(`scope`, `path`). That metadata is the point of discovery (distinguish user- vs project-scoped,
show origin/kind), so the type must grow (append-only — keep the existing fields).

`get_commands` is a **request/response** Pi RPC and is cwd/session-scoped (project-level commands
live under the session's working dir), so it is issued against the **live session transport** — the
same pattern as the sprint-037 slash-command ops, not the client-level `topLevel()` scratch-process
path used by `listModels`.

## Scope references
- `packages/server/src/agent/provider-contract.ts` (`AgentCommandDefinition`, the `AgentSession`
  optional-capability convention — `listCommands?` is already in the list)
- `packages/server/src/agent/providers/pi/agent.ts` (`PiAgentSession`; existing
  `getSessionStats`/`getForkMessages` `this.transport.request(...)` + array-guard pattern)
- `packages/server/src/agent/providers/pi/rpc-transport.ts` (`PiRpcTransport.request(command)`)
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` § `get_commands`;
  `dist/modes/rpc/rpc-types.d.ts` (`RpcSlashCommand`); `dist/core/source-info.d.ts` (`SourceInfo`)
- `packages/server/AGENTS.md` § Provider isolation (contract is the only surface the server touches)

## What to build
1. In `provider-contract.ts`, enrich `AgentCommandDefinition` (append-only — do NOT remove
   `id`/`label`/`description`):
   - add `name: string` (invoke token without `/`), `source?: "extension" | "prompt" | "skill"`,
     `scope?: "user" | "project" | "temporary"`, `path?: string`.
   - `listCommands?` stays as declared.
2. In `PiAgentSession` (alongside `getSessionStats` et al.), implement `listCommands()`:
   - `const data = await this.transport.request("get_commands")`, read `data.commands`
     (array-guard exactly like `getForkMessages`), map each `RpcSlashCommand` →
     `AgentCommandDefinition`: `name`→`name` **and** `id`, `description`→`description`,
     `source`→`source`, `sourceInfo.scope`→`scope`, `sourceInfo.path`→`path`.
   - Return `[]` when `commands` is absent/non-array. Add a docstring referencing
     `docs/rpc.md § get_commands`, matching the neighbouring method style.

## Out of scope
- Wire schemas (task-001). Daemon handler (task-003). Mock stub + verification (task-004).
- Any streaming/queue semantics — `get_commands` is a plain read against the live session.

## Acceptance criteria
- [ ] `AgentCommandDefinition` gains `name`/`source`/`scope`/`path` (optional except `name`); no
      existing field removed → `mock` still compiles.
- [ ] `PiAgentSession.listCommands()` issues `get_commands` and maps the response fields; returns
      `[]` when absent.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Tests: extend `packages/server/src/agent/providers/pi/pi-adapter.test.ts` — script a
  `get_commands` case on the fake transport returning mixed `source`/`scope` entries; assert the
  adapter sends `get_commands` and maps name/id/description/source/scope/path, plus the `[]`-on-
  absent path. `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`.

## Notes
- `FakeTransport.request(command)` scripts a fixed switch; add the `get_commands` arm.
- Keep the `provider-contract.ts` optional-capability doc comment in sync if it enumerates methods.
