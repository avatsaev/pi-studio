# Task 001 — AgentClient/AgentSession contracts + mock provider

- **Sprint:** sprint-005-provider-lifecycle
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005 (sprint-004), task-004 (sprint-002)

## Goal
Define the provider-neutral `AgentClient`/`AgentSession` contracts and ship the in-process `mock`
provider used for tests/load-testing.

## Scope references
- `clean-room-scope/features/agent-providers.md` § AgentClient, § AgentSession, § Capability flags
- `clean-room-scope/features/agent-sessions.md` § Stream events

## What to build
- `AgentClient` interface: `provider`, `capabilities`, `createSession`, `resumeSession`,
  `listModels`, `isAvailable`, optional `listModes`/`listImportableSessions`/`importSession`/
  `getDiagnostic`.
- `AgentSession` interface: `provider`, `id`, `capabilities`, `features?`, `run`/`startTurn`,
  `subscribe`, `streamHistory`, `getRuntimeInfo`, mode getters/`setMode`, `getPendingPermissions`/
  `respondToPermission`, `describePersistence`, `interrupt`, `close`, optional `listCommands`/
  `setModel`/`setThinkingOption`/`setFeature`/`tryHandleOutOfBand`.
- `AgentCapabilityFlags`: `supportsStreaming`, `supportsSessionPersistence`, `supportsDynamicModes`,
  `supportsMcpServers`, `supportsReasoningStream`, `supportsToolInvocations`.
- `mock` provider implementing both contracts in-memory, emitting scripted `AgentStreamEvent`s.

## Out of scope
- Pi process adapter (task-002). Registry/snapshot (task-003).

## Acceptance criteria
- [ ] The `mock` provider creates a session and streams a scripted turn (`turn_started`→
      `assistant_message`→`turn_completed`).
- [ ] `mock` exposes capability flags and supports `interrupt` → `turn_canceled`.
- [ ] Contracts compile and are consumed without provider-specific imports elsewhere.

## Test / verification plan
- Tests: `npx vitest run .../mock-provider.test.ts` — scripted turn, interrupt, capability flags.

## Notes
- The mock is dev/test only and never user-selectable in production paths.
