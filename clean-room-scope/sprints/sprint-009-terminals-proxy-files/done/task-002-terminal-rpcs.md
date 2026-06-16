# Task 002 — Terminal control RPCs + restore/capture

- **Sprint:** sprint-009-terminals-proxy-files
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Wire the terminal control RPC surface and capture/restore semantics.

## Scope references
- `clean-room-scope/features/terminals.md` § Control RPCs, § Restore / snapshot

## What to build
- Handlers: `ListTerminalsRequest`, `SubscribeTerminalsRequest`/`UnsubscribeTerminalsRequest`,
  `CreateTerminalRequest`, `RenameTerminalRequest`, `SubscribeTerminalRequest`/
  `UnsubscribeTerminalRequest`, `TerminalInput` (or binary input frame), `KillTerminalRequest`,
  `CaptureTerminalRequest`, `StartWorkspaceScriptRequest`.
- `capture(slot)`: return current screen text (one-shot, no subscribe) for CLI/MCP.
- Restore modes gated by `features["terminal-restore-modes"]`; reflowable snapshot advertised via
  `CLIENT_CAPS.terminal_reflowable_snapshot`.

## Out of scope
- Service proxy (task-003). MCP/CLI terminal mirrors (sprint-010/011).

## Acceptance criteria
- [ ] List/create/rename/kill terminals via RPC mutate manager state.
- [ ] `capture` returns current screen text without subscribing.
- [ ] An old client without restore-modes falls back to basic snapshot behavior.
- [ ] `StartWorkspaceScriptRequest` starts a `pi-studio.json` script as a terminal.

## Test / verification plan
- Tests: `npx vitest run .../terminal-rpcs.test.ts` — lifecycle RPCs, capture, restore-mode gating.

## Notes
- Service-type scripts are handed to the service proxy (task-003).
