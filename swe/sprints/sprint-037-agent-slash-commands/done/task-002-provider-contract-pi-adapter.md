# Task 002 — Provider-contract methods + Pi adapter RPC wiring

- **Sprint:** sprint-037-agent-slash-commands
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Extend the provider-neutral `AgentSession`/`AgentClient` contract with the new slash-command
operations as **optional** methods, and implement them in the Pi adapter by calling the
corresponding Pi RPC commands over the existing transport.

## Scope references
- `packages/server/src/agent/provider-contract.ts` (`AgentSession`, `AgentClient`, optional-capability convention)
- `packages/server/src/agent/providers/pi/agent.ts` (`PiAgentSession`, `PiAgentClient`, existing `topLevel()` / `transport.request()` / `transport.notify()` usage)
- `packages/server/src/agent/providers/pi/rpc-transport.ts` (`PiRpcTransport.request(command, params?)`)
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- `packages/server/AGENTS.md` § Provider isolation (contract is the only surface the server touches)

## What to build
Add optional methods to `AgentSession` in `provider-contract.ts` (optional so `mock` and other
providers can omit; the pattern already used by `setModel?`, `listCommands?`, etc.). Suggested
signatures (return provider-neutral result objects mirroring task-001 response data):

- `getSessionStats?(): Promise<AgentSessionStats>`
- `compact?(customInstructions?: string): Promise<AgentCompactResult>`
- `newSession?(): Promise<{ cancelled: boolean }>`
- `switchSession?(sessionPath: string): Promise<{ cancelled: boolean }>`
- `fork?(entryId: string): Promise<{ text: string; cancelled: boolean }>`
- `getForkMessages?(): Promise<{ entryId: string; text: string }[]>`
- `clone?(): Promise<{ cancelled: boolean }>`
- `setSessionName?(name: string): Promise<void>`
- `exportHtml?(outputPath?: string): Promise<{ path: string }>`
- `cycleModel?(): Promise<AgentCycleModelResult>`
- `getLastAssistantText?(): Promise<string | null>`

(`setModel?` already exists — for `/model` set, reuse it; if it currently only tracks locally,
change the Pi implementation to issue the `set_model` RPC. Verify current behavior first.)

Implement each in `PiAgentSession` via `this.transport.request("<command>", params)` — these are
**request/response** commands (correlated `{type:"response"}`), NOT fire-and-forget like `prompt`.
Map the returned `data` into the neutral result type. Add small result interfaces to the contract.

## Out of scope
- Wire schemas (task-001). Daemon RPC handlers (task-003). Mock stubs (task-004). SDK/CLI (005/006).
- Streaming/queue semantics: these commands operate on the live session; if Pi rejects a command
  while streaming, surface the error unchanged (do not auto-queue).

## Acceptance criteria
- [ ] New optional methods added to `AgentSession` (and any needed result interfaces).
- [ ] `PiAgentSession` implements each via `transport.request(...)`, returning mapped neutral results.
- [ ] `/model` set issues the Pi `set_model` RPC (not local-only) — verified against current code.
- [ ] No non-optional contract change that breaks `mock` compilation.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Tests: extend `packages/server/src/agent/providers/pi/pi-adapter.test.ts` using the existing
  `FakeTransport` — script `get_session_stats`, `compact`, `new_session`, `fork`, `clone`,
  `set_session_name`, `export_html`, `cycle_model`, `get_last_assistant_text` responses and assert
  the adapter sends the right command and maps the response. `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`.

## Notes
- `FakeTransport.request(command)` currently only scripts `get_available_models`; extend it.
- Keep the `provider-contract.ts` doc comment's optional-capability list in sync.
