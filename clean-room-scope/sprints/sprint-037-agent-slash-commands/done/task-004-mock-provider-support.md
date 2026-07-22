# Task 004 — Mock provider support + handler test fixtures

- **Sprint:** sprint-037-agent-slash-commands
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
Give the `mock` provider deterministic implementations (or explicit non-support) of the new
optional session methods so the daemon RPC handlers can be exercised end-to-end in tests without a
real `pi` binary.

## Scope references
- `packages/server/src/agent/providers/mock/mock-provider.ts` (existing mock `AgentSession`/`AgentClient`; already stubs `importSession`)
- `packages/server/src/agent/provider-contract.ts` (optional method signatures from task-002)
- `packages/server/AGENTS.md` § mock provider (dependency-free smoke testing)

## What to build
Implement a purposeful subset on the mock `AgentSession` so integration tests are meaningful:

- `getSessionStats()` → returns a fixed synthetic stats object (stable numbers).
- `compact()` → returns a synthetic `{summary, firstKeptEntryId, tokensBefore}`.
- `newSession()` / `clone()` / `switchSession()` → `{cancelled: false}`.
- `fork(entryId)` → `{text: "<mock forked text>", cancelled: false}`; `getForkMessages()` → a fixed list.
- `setSessionName(name)` → records the name (retrievable via runtime info if convenient).
- `exportHtml()` → `{path: "<mock path>"}`.
- `cycleModel()` → synthetic model result; `getLastAssistantText()` → last synthetic assistant message or null.

Any method deliberately left unsupported must simply be omitted (optional) so task-003's
"provider method absent → rpc_error" path is also test-covered by at least one omitted method.

## Out of scope
- Real Pi behavior (covered by the Pi adapter unit tests in task-002).
- SDK/CLI (tasks 005/006).

## Acceptance criteria
- [ ] Mock session implements the subset above with deterministic outputs.
- [ ] At least one optional method is intentionally omitted to exercise the unsupported→`rpc_error` path.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Tests: the mock feeds task-003's handler tests. Add/extend
  `packages/server/src/agent/providers/mock/mock-provider.test.ts` asserting the deterministic
  outputs. `npx vitest run packages/server/src/agent/providers/mock/mock-provider.test.ts` and the
  task-003 handler suite both pass.

## Notes
- Keep outputs stable (no timestamps/random) so assertions don't flake.
