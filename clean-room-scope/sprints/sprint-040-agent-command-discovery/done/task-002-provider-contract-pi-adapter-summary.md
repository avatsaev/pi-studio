# Task 002 — Enrich command-definition contract + implement Pi `listCommands` — Summary

- **Sprint:** sprint-040-agent-command-discovery
- **Completed:** 2026-07-26
- **Status:** done

## What was implemented
Grew the provider-neutral `AgentCommandDefinition` to carry discovery metadata and implemented the
previously-declared-but-unimplemented `AgentSession.listCommands?()` in the Pi adapter.

- `AgentCommandDefinition` (`provider-contract.ts`) gained `name: string` (required — the invoke
  token without the leading `/`), `source?: "extension" | "prompt" | "skill"`,
  `scope?: "user" | "project" | "temporary"`, `path?: string`. `id`/`label`/`description` are
  untouched (append-only).
- `PiAgentSession.listCommands()` calls `this.transport.request("get_commands")` (Pi RPC
  `docs/rpc.md § get_commands`), array-guards `data.commands` exactly like `getForkMessages`
  (`Array.isArray` check, `[]` fallback), and maps each `RpcSlashCommand` → `AgentCommandDefinition`:
  `name` → both `id` and `name`, `description` → `description`, `source` → `source`,
  `sourceInfo.scope` → `scope`, `sourceInfo.path` → `path`.
  - Verified the actual field shape against
    `node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts`
    (`RpcSlashCommand { name, description?, source, sourceInfo }`) and
    `dist/core/source-info.d.ts` (`SourceInfo { path, source, scope, origin, baseDir? }`,
    `SourceScope = "user" | "project" | "temporary"`) — the `.d.ts` types are the ground truth for
    what the RPC actually returns; `docs/rpc.md`'s prose example uses an older `location` field
    name that doesn't match the shipped type, so the adapter reads `sourceInfo.scope`/
    `sourceInfo.path` per the `.d.ts`, matching the task's cited scope references.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/provider-contract.ts` | enriched `AgentCommandDefinition` with `name`/`source`/`scope`/`path` (doc comment explains append-only rationale) |
| `packages/server/src/agent/providers/pi/agent.ts` | added `AgentCommandDefinition` import; implemented `PiAgentSession.listCommands()` |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | added a `get_commands` arm to `FakeTransport` (3 mixed-source/scope entries lifted from the RPC doc's own example); added two tests: full field-mapping assertion, and a `NoCommandsTransport` subclass proving the `[]`-on-absent path |

## How it satisfies the scope
- No existing field removed from `AgentCommandDefinition` — the `mock` provider (which doesn't yet
  implement `listCommands`) still compiles untouched.
- `listCommands()` issues exactly `get_commands` (no params), matching the `getSessionStats`/
  `getForkMessages` sibling-method style (cast the transport response, array-guard, map).
- Docstring added referencing `docs/rpc.md § get_commands`, matching the neighbouring methods'
  comment style (e.g. `/** get_commands ... */`).

## Build & test results
```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean, no output)

$ npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts
 Test Files  1 passed (1)
      Tests  33 passed (33)
```

## Acceptance criteria
- [x] `AgentCommandDefinition` gains `name`/`source`/`scope`/`path` (optional except `name`); no
      existing field removed → `mock` still compiles. (verified: clean `tsc -b`, no callers
      constructed the old shape)
- [x] `PiAgentSession.listCommands()` issues `get_commands` and maps the response fields; returns
      `[]` when absent. (verified by the two new adapter tests)
- [x] `npm run build:server` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None beyond the sprint's stated deferrals (SDK/CLI/MCP/web-client surfaces — task-004's "Out of
  scope").
