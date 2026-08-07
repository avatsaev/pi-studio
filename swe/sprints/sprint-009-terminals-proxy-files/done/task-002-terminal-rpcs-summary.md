# Task 002 — Terminal control RPCs + restore/capture — Summary

- **Sprint:** sprint-009-terminals-proxy-files
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/terminal/terminal-rpc.ts` — `registerTerminalHandlers(registry, deps, getSessions)`:
- **Lifecycle:** `list_terminals_request`, `subscribe_terminals_request`/`unsubscribe_terminals_request`,
  `create_terminal_request`, `rename_terminal_request`, `kill_terminal_request` — all mutate the
  `TerminalManager` and broadcast a `terminals_update`.
- **Per-slot stream:** `subscribe_terminal_request` pipes the manager's binary frames (Snapshot then
  Output) to the requesting session via `session.sendBinary`; `unsubscribe_terminal_request` stops it.
  Tracked per `(session.id, slot)`.
- **Input:** `terminal_input` text RPC (base64 → bytes) plus `makeTerminalBinaryHandler(manager)` for
  the binary frame dispatcher (decodes `Input`/`Resize` opcodes).
- **`capture_terminal_request`:** returns current screen text one-shot (no subscribe).
- **`start_workspace_script_request`:** reads `pi-studio.json` scripts, spawns the named script as a
  terminal, flags `type:"service"` scripts (`entry.service`) for hand-off to the service proxy.
- **Restore-mode gating:** the requested `restoreMode` is honored only when the daemon advertises
  `features["terminal-restore-modes"]` AND the client advertised
  `CLIENT_CAPS.terminal_reflowable_snapshot` (`session.supports(...)`); otherwise it falls back to
  `"basic"`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/terminal/terminal-rpc.ts` | created |
| `packages/server/src/terminal/index.ts` | modified (re-export) |
| `packages/server/src/terminal/terminal-rpcs.test.ts` | added — 6 tests |

## Build & test results
```
$ npm run build:server                                              → exit 0
$ npx vitest run packages/server/src/terminal/terminal-rpcs.test.ts → 6 passed
$ npx oxlint / oxfmt --check packages/server/src/terminal            → clean
```

## Acceptance criteria
- [x] List/create/rename/kill terminals via RPC mutate manager state.
- [x] `capture` returns current screen text without subscribing.
- [x] An old client without restore-modes falls back to basic snapshot behavior (`restoreMode:"basic"`).
- [x] `StartWorkspaceScriptRequest` starts a `pi-studio.json` script as a terminal.

## Follow-ups / TODO(verify)
- Service-type scripts are flagged (`service:true`) and handed to the service proxy in task-003.
- Exact wire names for `TerminalInput` vs binary input frame (both paths provided).
