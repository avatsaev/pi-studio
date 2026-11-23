# Task 001 — Protocol: the `daemon_update_*` family and the `daemonUpdate` flag

- **Sprint:** sprints/sprint-136-daemon-update-service
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The four request/response pairs, the `daemon_update_status` broadcast and `DaemonUpdateStatus` are real schemas in the session message union; the flag exists.

## Context / why
Spec § Feature flag, § RPCs and the broadcast (P1, P2).

## Scope references
- `swe/features/self-update.md` § Public contract
- `packages/protocol/src/messages.ts`, `client-capabilities.ts` (+ `client-capabilities.test.ts`), `messages.envelopes.test.ts`, `packages/protocol/src/index.ts`

## What to build
- Schemas exactly as the spec's `DaemonUpdateStatus` (a discriminated `state.kind`), `.passthrough()` where the package's convention has it.
- `SERVER_FEATURES.daemonUpdate` with its compat entry as the file requires (added in the next version).
- No external-client fixture: the Rust clients do not consume this family (say so in `packages/protocol/AGENTS.md`).

## Out of scope
Handlers (task-003), SDK (task-002).

## Acceptance criteria
- [ ] Round-trip tests for every state kind and every message; an unknown `state.kind` is rejected or passed per the file's convention (state which).
- [ ] The capability key list test passes.

## Test / verification plan
- `npx vitest run packages/protocol`
- `npm run build:protocol && npm run typecheck && npm run lint`

## Notes
Docs: `packages/protocol/AGENTS.md`.
