# Task 004 — Entity store schemas + accessors — Summary

- **Sprint:** sprint-003-persistence-config
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/persistence/entity-schemas.ts` (Zod schemas) and `entity-stores.ts`
(file-backed accessors) for every persisted daemon entity:

- **Agent record** → `agents/{sanitized-cwd}/{id}.json`. `agentRecordSchema` (full field table +
  `timeline` rows), `AgentFeature` discriminated union (toggle/select), `SerializableConfig`,
  `RuntimeInfo`, `PersistenceHandle`. `sanitizeCwd(cwd)` strips the FS root, joins with `-`, and maps
  a Windows drive to a `C-` prefix. `saveAgent` (atomic) / `loadAgent` (→ record | null).
- **Schedule** → `schedules/{id}.json` (id = 8 hex). Cadence (`every`/`cron`), target
  (`agent`/`new-agent`), `runs: ScheduleRun[]`. `saveSchedule`/`loadSchedule`.
- **Loop** → `loops/loops.json` (array). `createLoopStore(home)` wraps a single
  `createQueuedJsonWriter` so saves are non-atomic + serialized; `loadLoops` defaults to `[]`.
- **Chat** → `chat/rooms.json` (`{ rooms, messages }`). `loadChat`/`saveChat`.
- **Project / workspace registries** → `projects/{projects,workspaces}.json` (arrays with nullable
  `archivedAt` soft-delete). `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces`.

All schemas `.passthrough()` and use optional/default fields → unknown/optional fields tolerated on
load (no migration).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/persistence/entity-schemas.ts` | created |
| `packages/server/src/persistence/entity-stores.ts` | created |
| `packages/server/src/persistence/index.ts` | modified — re-exports both |
| `packages/server/src/persistence/entity-stores.test.ts` | added — 11 tests |

## How it satisfies the scope
- **persistence.md § Data shapes:** each field table reproduced (agent, schedule, loop, chat,
  project, workspace), reusing `agentStatusEnum` from protocol for `lastStatus`.
- **persistence.md § Behavior:** single-record stores write atomically; the loop store uses the
  queued non-atomic writer.
- **MAIN-SCOPE §5:** on-disk file layout + `sanitized-cwd` derivation.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/persistence/entity-stores.test.ts
 ✓ entity-stores.test.ts (11 tests)

# Full sprint re-verification
$ npm run build                 → exit 0
$ npx vitest run                → 13 files, 102 tests passed
$ npx oxlint                    → clean
$ npx oxfmt --check .           → clean
```

## Acceptance criteria
- [x] An agent persists to `agents/{sanitized-cwd}/{id}.json` and round-trips through Zod.
- [x] `sanitizeCwd` maps a path to a stable directory-safe key (POSIX + Windows drive).
- [x] Unknown/optional fields are tolerated on load (no migration needed).
- [x] Loop store uses the queued non-atomic writer (`createLoopStore`; concurrent saves serialize).
- [x] Project/workspace registries load arrays with `archivedAt` soft-delete fields.

## Follow-ups / TODO(verify)
- Loop worker/verifier override field names and nested `LoopIteration`/`LoopLogEntry`/timeline-row
  shapes are TODO(verify) (features/loops.md, sprint-006/010); modelled as `unknown[]` for now.
- Recovery rule (`running` loops → `stopped` at boot) and project dedup-by-`rootPath` are applied by
  services at boot in later sprints, not in these accessors.
