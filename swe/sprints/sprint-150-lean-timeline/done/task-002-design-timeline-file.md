# Task 002 — Design: the agent timeline file (owner review)

- **Sprint:** sprints/sprint-150-lean-timeline
- **Status:** done
- **Type:** docs
- **Area:** swe/architecture
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
A short design the owner approves before any code: where the timeline is stored, in what shape, and how
restart, compaction, fork and delete treat it.

## Context / why
Finding A5: the timeline lives only in memory (`timelinesByAgentId`, never evicted), stores one row per
streamed chunk, and pages in O(total rows). A6: after a restart it is rebuilt from Pi's session file
with new sequence numbers, so a client's cursor is invalid. This adds persisted state under
`$PI_STUDIO_HOME/agents/`, so it gets a design and a gate. **Task-003 starts only after the owner
approves this document.**

## Scope references
- `docs/daemon-audit-handoff.md` § A5, § A6, § Approved improvements (row 3)
- `packages/server/src/agent/timeline-store.ts`, `agent-service.ts`, `session-hydration.ts`
- `packages/server/src/persistence/entity-stores.ts` (agent record layout), root `AGENTS.md`
  § Persistence layout
- `swe/architecture/persistence.md`, `docs/agent-stream-events.md`

## What to build
`swe/architecture/agent-timeline-persistence.md`, deciding at least:
- File: `agents/<sanitized-cwd>/<agentId>.timeline.jsonl`, one row per line.
- Merging: streamed text and reasoning chunks become one row per message when written; what is written
  mid-turn so a crash loses at most the open message.
- Sequence numbers and epochs persisted and continued after a restart (no renumbering).
- Pi's session file read only when the timeline file does not exist (agents created before this
  change, imported sessions).
- `agent_timeline_reset` (fork, compaction-related resets) rewrites the file by temporary file and
  rename; archive keeps it; delete removes it.
- Memory: a bounded in-memory tail and an index by sequence for paging; paging cost O(page).
- Durability: when it syncs to disk, and the write cost per turn.
- The dev daemon's in-memory mode.
- The dead `record.timeline` field of the agent record.

## Acceptance criteria
- [ ] The owner approved the document (recorded in it, with the date).

## Test / verification plan
Owner review.

