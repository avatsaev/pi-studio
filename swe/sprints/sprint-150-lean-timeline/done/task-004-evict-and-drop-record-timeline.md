# Task 004 — Evict an agent's history on archive and delete; drop the dead `record.timeline`

- **Sprint:** sprints/sprint-150-lean-timeline
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (agent service, manager, session operations, persistence schema)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
An archived or deleted agent no longer holds its history in daemon memory, and the unused
`timeline` field of the agent record is gone.

## Context / why
Finding A5: `timelinesByAgentId` is a module-level map that only grows. Archive and delete never touch
it. Evicting on archive is safe: a later fetch of an archived agent rebuilds from Pi's file through the
seeding of task-001. **Idle eviction is deliberately not part of this task**: after a rebuild the
numbering restarts, and a tab that is still open would drop live events numbered below what it already
fetched (`use-session-resync.ts`). Revisit only if memory is seen to matter (all 406 real sessions held
merged are about 52 MB).

## Scope references
- `docs/daemon-audit-handoff.md` § A5; `swe/architecture/agent-timeline-persistence.md` § 2.1, § 14
- `packages/server/src/agent/agent-service.ts` (`timelinesByAgentId`, `timelineFor`)
- `packages/server/src/agent/agent-manager.ts` (`archiveAgent`, `deleteAgent`)
- `packages/server/src/agent/session-operations.ts` (`import_agent_session` writes `record.timeline`)
- `packages/server/src/persistence/entity-schemas.ts` (`timeline`), `entity-stores.ts`,
  `daemon/dev-bootstrap.ts`, `agent/providers/mock/` (anything writing `timeline: []`)

## What to build
- The timeline map becomes owned by `AgentService` (or a small registry it holds) instead of module
  state, with `evict(agentId)`. Archive and delete (including the children a delete cascades to) call
  it; a late event of a dying turn must not recreate the entry (the manager already closes the agent
  first, task-149/004).
- Remove every write of `record.timeline` (`create_agent`, import, mock/dev paths) and
  `ImportSessionResult.timeline`; drop the field from `agentRecordSchema`. The schema stays
  `.passthrough()`, so an existing record with `"timeline": []` still loads.

## Acceptance criteria
- [ ] After archive and after delete the service holds no store for the agent (test through the
      public surface, e.g. a count or the heap-visible registry size).
- [ ] A fetch for an archived agent still returns its history (rebuilt from the Pi file).
- [ ] Deleting an agent mid-turn does not recreate its store.
- [ ] A record file containing `"timeline": []` loads; a new record has no `timeline` key.

## Test / verification plan
- `npx vitest run packages/server/src/agent packages/server/src/persistence`
- `npm run build:server`
