# Task 002 — Requests to Pi time out, and a closed Pi is really stopped

- **Sprint:** sprints/sprint-149-agent-recovery
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (agent: Pi provider)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
No RPC waits forever on Pi, and closing a Pi process ends it and everything it started.

## Context / why
Finding A8 (folded into M3 by the owner, 2026-11-24). `request()` has no timeout, so `get_state`,
`compact`, `fork`, `get_available_models` can hang; `topLevel()` can leak the process it started for
model listing; `close()` sends SIGTERM only and leaves pending requests waiting; stdout is decoded per
chunk, corrupting a multibyte character split across chunks. Depends on task-001 (same files).

## Scope references
- `docs/daemon-audit-handoff.md` § A8, § Milestones (folded fixes)
- `packages/server/src/agent/providers/pi/rpc-transport.ts` (`request`, `close`, stdout/stderr decoding)
- `packages/server/src/agent/providers/pi/agent.ts` (`topLevel`, `listModels`, `resolveDefaultModel`)
- `packages/server/src/agent/slash-command-operations.ts` (compact: the SDK's 10-minute
  `COMPACT_TIMEOUT_MS` is the client side)

## What to build
- A per-request timeout: a default (60 s) and a longer one for `compact` (10 min, matching the SDK). A
  timeout rejects with a message naming the command and is logged; it does not kill the process.
- `close()`: reject pending requests; SIGTERM the tree, then SIGKILL after a grace period (5 s) if the
  process has not exited.
- `topLevel()`: the process it starts is closed on success, failure and timeout.
- stdout and stderr decoded with `StringDecoder` (or `setEncoding("utf8")`).

## Acceptance criteria
- [ ] Fake transport that never answers: `request` rejects after the timeout (fake timers).
- [ ] A process ignoring SIGTERM is SIGKILLed after the grace period (test with a real child script).
- [ ] A 4-byte UTF-8 character split across two chunks arrives intact.
- [ ] `topLevel` closes its process when the request times out.

## Test / verification plan
- `npx vitest run packages/server/src/agent/providers/pi`
- `npm run build:server`
