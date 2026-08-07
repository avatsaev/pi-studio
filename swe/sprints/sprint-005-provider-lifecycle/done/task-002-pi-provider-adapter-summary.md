# Task 002 — Pi provider adapter (pi --mode rpc) — Summary

- **Sprint:** sprint-005-provider-lifecycle
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `agent/providers/pi/rpc-transport.ts` — `PiRpcTransport` interface (`request`/`notify`/`onEvent`/
  `close`), a default NDJSON-over-stdio `createProcessTransport` that spawns `pi --mode rpc`, and
  `resolveBinaryOnPath` (PATH scan). Transport is injectable for tests.
- `agent/providers/pi/event-mapper.ts` — `mapPiEvent` (raw Pi event → `AgentStreamEvent`) and
  `mapToolCall` (Pi tool name → `ToolCallDetail` kind: shell/read/edit/write/search/fetch/task,
  unknown → task).
- `agent/providers/pi/agent.ts` — `PiAgentClient` / `PiAgentSession`:
  - `createSession` spawns `pi --mode rpc` (or configured `command`) in `cwd` with merged `env`;
    `buildPiArgs` appends `--append-system-prompt` (never replaces Pi's prompt) and optional
    `--mcp-config` (generation deferred to sprint-010).
  - `run`/`startTurn` send the prompt over RPC; streamed events are mapped and fanned out.
  - `isAvailable()` resolves the `pi` binary on `$PATH`.
  - `listModels`/`listModes` use **top-level RPC calls** (spawn → `request` → close), never a scratch
    session.
  - `listImportableSessions` reads JSONL session files from `params.sessionDir`; `resumeSession`/
    `importSession` use the session file as `nativeHandle`.
  - Custom `extends:"pi"` profiles reuse this client via `deps.provider`/`command`/`sessionDir`.

## Files created / changed
| File | Change |
|------|--------|
| `agent/providers/pi/rpc-transport.ts` | created |
| `agent/providers/pi/event-mapper.ts` | created |
| `agent/providers/pi/agent.ts` | created |
| `agent/index.ts` | modified — re-exports pi adapter |
| `agent/providers/pi/pi-adapter.test.ts` | added — 8 tests |
| (lint) `mock-provider.ts`, `ws/ws-server.test.ts` | minor lint fixes |

## How it satisfies the scope
- **agent-providers.md § Pi lifecycle / § Models·modes·features / § Import & resume:** spawn
  `pi --mode rpc`, append (not replace) system prompt, MCP via `--mcp-config`, runtime discovery via
  top-level RPC, JSONL import + resume-by-file-handle, custom-profile launch via `command`.
- **agent-sessions.md § Stream events:** RPC events map to the `AgentStreamEvent`/`ToolCallDetail` kinds.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts
 ✓ pi-adapter.test.ts (8 tests)
 Test Files  1 passed (1)      Tests  8 passed (8)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] With a fake RPC transport, `createSession` spawns the process and a turn streams mapped events.
- [x] System prompts are passed via `--append-system-prompt`, not by replacing Pi's prompt.
- [x] `isAvailable()` is false when `pi` is not resolvable.
- [x] Models/modes are discovered via RPC top-level calls (no scratch session; no `send_prompt`).
- [x] Import discovery enumerates JSONL session files; resume uses the file as `nativeHandle`.

## Follow-ups / TODO(verify)
- Exact Pi RPC framing, method names (`send_prompt`/`set_mode`/`list_models`/…), JSONL session
  layout, and honored `params` keys are TODO(verify) — the transport/mapper tolerate variants.
- MCP `--mcp-config` generation + permission/question bridge land in sprints 010/006.
