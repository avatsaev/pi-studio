# Task 001 — Protocol: the `binary` install kind, `unmanaged_binary`, `skippedVersion`

- **Sprint:** sprints/sprint-142-binary-self-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol, packages/client
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
The `daemon_update_*` schemas accept the new install kind, the new `cannot_update` reason and the
optional `skippedVersion`; the SDK's types follow.

## Context / why
Append-only additions (root `AGENTS.md` invariant 1); the family has no external fixtures.

## Scope references
- `swe/features/self-update.md` § RPCs and the broadcast (milestone 6 parts)
- `packages/protocol/src/messages.ts` (the daemon update status schema), `packages/client/src/` (status type)

## What to build
`installKind` gains `"binary"`; `cannot_update.reason` gains `"unmanaged_binary"`; the status gains
`skippedVersion?: string`. Protocol tests: each new value parses, an unknown one still fails as before.

## Out of scope
Producing the values (task-002, task-004).

## Acceptance criteria
- [ ] Protocol and client tests pass; `npm run typecheck` green across packages.

## Test / verification plan
- `npx vitest run packages/protocol packages/client`; `npm run typecheck`

## Notes
`packages/protocol/AGENTS.md` and root `AGENTS.md` § Protocol overview are amended at close (sprint-145/task-002).
