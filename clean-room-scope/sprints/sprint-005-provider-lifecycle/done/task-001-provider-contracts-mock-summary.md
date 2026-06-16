# Task 001 — AgentClient/AgentSession contracts + mock provider — Summary

- **Sprint:** sprint-005-provider-lifecycle
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `packages/server/src/agent/provider-contract.ts` — the provider-neutral contracts: `AgentClient`
  (`provider`, `capabilities`, `createSession`, `resumeSession`, `listModels`, `isAvailable`, optional
  `listModes`/`listImportableSessions`/`importSession`/`getDiagnostic`) and `AgentSession`
  (`run`/`startTurn`, `subscribe`, `streamHistory`, `getRuntimeInfo`, mode getters/`setMode`,
  `getPendingPermissions`/`respondToPermission`, `describePersistence`, `interrupt`, `close`, optional
  `listCommands`/`setModel`/`setThinkingOption`/`setFeature`/`tryHandleOutOfBand`). Plus supporting
  types (`PersistenceHandle`, `LaunchContext`, model/mode/command definitions, import rows). Imports
  only protocol types — no concrete-provider imports.
- `packages/server/src/agent/providers/mock/mock-provider.ts` — `MockAgentClient` + in-memory
  `MockAgentSession` emitting a scripted turn (`turn_started` → `assistant_message` → `turn_completed`),
  `interrupt()` → `turn_canceled`, capability flags `MOCK_CAPABILITIES`, models/modes/runtime info and
  a persistence handle. `createMockClient()` factory matches the registry signature.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/provider-contract.ts` | created |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | created |
| `packages/server/src/agent/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports agent |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | added — 5 tests |

## How it satisfies the scope
- **agent-providers.md § AgentClient / § AgentSession / § Capability flags:** the abridged contracts
  and the six `AgentCapabilityFlags` (reused from protocol) are reproduced; the mock is the dev/test
  in-process provider.
- **agent-sessions.md § Stream events:** the mock emits the documented `AgentStreamEvent` kinds.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/agent/providers/mock/mock-provider.test.ts
 ✓ mock-provider.test.ts (5 tests)
 Test Files  1 passed (1)      Tests  5 passed (5)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] The `mock` provider creates a session and streams a scripted turn (`turn_started` →
      `assistant_message` → `turn_completed`).
- [x] `mock` exposes capability flags and supports `interrupt` → `turn_canceled`.
- [x] Contracts compile and are consumed without provider-specific imports elsewhere (contract file
      depends only on protocol + the persistence `AgentFeature` type).

## Follow-ups / TODO(verify)
- Run/turn option shapes (`RunOptions`, import args) are minimal; exact wire field names are
  refined in sprint-006. The Pi adapter (task-002) and registry/snapshot (task-003) consume these
  contracts next.
