# Task 002 — Pi provider adapter (pi --mode rpc)

- **Sprint:** sprint-005-provider-lifecycle
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the Pi provider adapter that spawns and drives `pi --mode rpc`, exposing the
`AgentClient`/`AgentSession` contracts.

## Scope references
- `clean-room-scope/features/agent-providers.md` § Pi lifecycle, § Models/modes/features, § Import & resume
- `clean-room-scope/features/agent-sessions.md` § Stream events

## What to build
- `agent/providers/pi/agent.ts`: `createSession` spawns `pi --mode rpc` (or configured `command`) in
  `cwd` with `env`; pass Pi-Studio system prompts via `--append-system-prompt` (preserve Pi's default
  prompt); if injecting MCP, pass a generated `--mcp-config` (writing handled later — never edit
  user/project MCP files).
- `run`/`startTurn` send the prompt over RPC; map RPC events → `AgentStreamEvent` (assistant,
  reasoning, tool calls, turn markers) and tool calls → `ToolCallDetail` kinds.
- `isAvailable()` checks the `pi` binary on `$PATH`.
- Import discovery reads Pi's persisted JSONL session files (no recent-session RPC); resume/history
  hydrate via `pi --mode rpc` using the session file as `nativeHandle`.
- Discover models/modes/commands/features via Pi RPC top-level calls.

## Out of scope
- MCP config generation specifics (sprint-010). Registry/snapshot caching (task-003).
  Permission/question bridge (sprint-006).

## Acceptance criteria
- [ ] With a fake `pi` on PATH (or RPC stub), `createSession` spawns the process and a turn streams events.
- [ ] System prompts are passed via `--append-system-prompt`, not by replacing Pi's prompt.
- [ ] `isAvailable()` is false when `pi` is not resolvable.
- [ ] Models/modes are discovered via RPC top-level calls (not by creating a scratch session).
- [ ] Import discovery enumerates JSONL session files; resume uses the file as `nativeHandle`.

## Test / verification plan
- Tests: `npx vitest run .../pi-adapter.test.ts` using a stubbed RPC transport / fake binary.

## Notes
- Pi session JSONL layout + full RPC surface + honored `params` keys are TODO(verify).
