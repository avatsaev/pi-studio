# Task 005 — Archive (soft delete) + cascade — Summary

- **Sprint:** sprint-005-provider-lifecycle
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Added `AgentManager.archiveAgent(id)` (in `agent/agent-manager.ts`) implementing global soft-delete
with recursive cascade:
- Snapshots the live session's persistence handle into the record (resume later).
- Sets `archivedAt = now`; normalizes `lastStatus` away from `running`/`initializing` → `closed`.
- Notifies subscribers with a new `agent_archived` event (subscriber type broadened to
  `AgentManagerEvent = AgentUpdateBroadcast | AgentArchivedBroadcast`).
- Closes/kills the runtime (`session.close()`, then detaches).
- Cascades: for each agent whose `labels["pi-studio.parent-agent-id"] == id` and not yet archived,
  `archiveAgent(child.id)` recursively. Detached agents (no parent label) are never cascade-archived.
- Idempotent: archiving an already-archived agent is a no-op (no re-cascade).
- Archived records stay on disk (`archivedAt` set) but drop out of `list()` (active), remaining in
  `listAll()`.

## Files created / changed
| File | Change |
|------|--------|
| `agent/agent-manager.ts` | modified — `archiveAgent`, `AgentArchivedBroadcast`, `AgentManagerEvent` |
| `agent/archive.test.ts` | added — 4 tests |

## How it satisfies the scope
- **agent-lifecycle.md § Archive (soft delete, global) / § Subagents vs. detached:** the documented
  archive pseudocode (snapshot → archivedAt → normalize → notify → close runtime → cascade) and the
  detached-survives rule are reproduced.
- **subagents.md § Track membership rule:** track membership is `parentAgentId === parent.id &&
  !archivedAt`; archived children leave the active list / track.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/agent/archive.test.ts
 ✓ archive.test.ts (4 tests)

# Full sprint re-verification
$ npm run build                 → exit 0
$ npx vitest run                → 25 files, 171 tests passed
$ npx oxlint                    → clean
$ npx oxfmt --check .           → clean
```

## Acceptance criteria
- [x] Archiving a parent cascades to all parent-agent-id-linked non-detached children recursively
      (parent → child1/child2 → grandchild all archived).
- [x] A detached child (no parent label) survives the parent's archive.
- [x] Archiving a running agent closes/kills its runtime and normalizes `lastStatus` (→ closed) and
      snapshots its persistence handle.
- [x] Archived agents are excluded from active lists (`list()`) but remain on disk (`listAll()` +
      persisted `archivedAt`).

## Follow-ups / TODO(verify)
- `autoArchive` on terminal turn (sprint-006), worktree archive coupling (sprint-008), and client
  tab→archive rules (sprint-012) build on this single global archive gesture.
- Exact terminal-event names triggering auto-archive vs. lifecycle normalization are TODO(verify).
