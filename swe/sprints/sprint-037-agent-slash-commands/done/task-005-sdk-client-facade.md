# Task 005 — SDK / client facade methods

- **Sprint:** sprint-037-agent-slash-commands
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001, task-003

## Goal
Expose the new slash-command operations on the `PiStudioClient` `AgentHandle` (and any non-scoped
convenience export), mapping 1:1 to the task-001 RPC types, so CLI (and later web-client) share one
typed surface.

## Scope references
- `packages/client/src/pistudio-client.ts` (`AgentHandle` interface + impl: existing `interrupt()`, `update()`, `resume()`, `archive()`, `delete()` all via `this.daemon.request("<type>", {agentId, ...})`; non-scoped `importAgentSession(daemon, args)`)
- `packages/client/AGENTS.md` (facade mirrors server RPC type names)
- Task-001 protocol types

## What to build
Add to the `AgentHandle` interface and its implementation, each a thin `this.daemon.request(...)`
wrapper carrying `agentId` (mirroring `interrupt()`):

- `sessionStats(): Promise<AgentSessionStatsResponse>`
- `compact(customInstructions?): Promise<...>`
- `newSession(): Promise<...>`
- `switchSession(sessionPath): Promise<...>`
- `fork(entryId): Promise<...>`  /  `forkMessages(): Promise<...>`
- `clone(): Promise<...>`
- `setSessionName(name): Promise<...>`
- `exportHtml(outputPath?): Promise<...>`
- `setModel(provider, modelId): Promise<...>`  /  `cycleModel(): Promise<...>`
- `lastAssistantText(): Promise<...>`

Use the protocol response types for return values where task-001 exports them. Update the facade's
header doc comment listing the mirrored RPC type names.

## Out of scope
- Wire schemas (task-001), handlers (task-003), CLI (task-006), web-client (deferred).

## Acceptance criteria
- [ ] Each operation is a typed method on `AgentHandle` mapping to its task-001 RPC type with `agentId`.
- [ ] Return types use the protocol response types where available.
- [ ] `npm run build:client` and `npm run typecheck` pass.

## Test / verification plan
- Tests: extend `packages/client/src/pistudio-client.test.ts` with a fake `DaemonClient` asserting
  each method issues the correct RPC type + params and returns the resolved payload.
  `npx vitest run packages/client/src/pistudio-client.test.ts`.

## Notes
- Follow the exact existing wrapper style; no client-side validation beyond what the driver does.
