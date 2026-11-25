# Task 001 — Drop chat rooms, loops and schedules

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/server, packages/cli, packages/protocol, docs
- **Priority:** P2
- **Estimated size:** M
- **Depends on:** sprint-146/task-006

## Goal
The chat, loop and schedule features are gone from the daemon, the CLI and the docs.

## Context / why
Owner decision 2026-11-24 (approved drop). Finding F8: CLI-only, schedules never fire (`tick()` has no
caller), loops are never recovered, the CLI payloads do not match the handlers, and `loop_run_request`
runs a client-supplied shell command. No external-client fixture names these families (checked).

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Approved drops: scope (chat rooms, loops, schedules), § F8
- `packages/server/src/orchestration/`, `packages/server/src/daemon/orchestration-rpc.ts`
- `packages/server/src/daemon/bootstrap.ts` (schedule and loop executors, `lastAssistantText`)
- `packages/server/src/daemon/dev-bootstrap.ts` (`schedule_list_request` stub)
- `packages/server/src/agent/agent-manager.ts` (`onRecoverLoops`)
- `packages/server/src/persistence/atomic-store.ts` (`STORE_SUBDIRECTORIES`, the queued loop writer),
  `entity-schemas.ts`, `entity-stores.ts` (schedule, chat, loop schemas and stores)
- `packages/cli/src/feature-commands.ts` (`chat`, `loop`, `schedule` groups)
- `packages/protocol/src/messages.ts` (comment at the session union; any chat/loop/schedule schema)

## What to build
Delete the above and their tests. `createQueuedJsonWriter` goes if the loop store was its only user.
`STORE_SUBDIRECTORIES` no longer creates `schedules/`, `chat/`, `loops/`; existing folders on disk are
left alone. Docs in the same change: root `AGENTS.md` persistence layout and monorepo blurbs,
`packages/server/AGENTS.md`/`README.md`, `packages/cli/README.md`/`AGENTS.md`, fern CLI pages, and the
`swe/features/` specs for chat rooms, loops and schedules marked retired (one line at the top, with
the date and the handoff link).

## Out of scope
`registerAlias` itself (sprint-148/task-001 removes it once no alias is left).

## Acceptance criteria
- [ ] No reference to `ScheduleService`, `LoopService`, `ChatService`, `chat_`, `loop_` or `schedule_`
      RPC names in `packages/*/src` outside tests that assert their absence.
- [ ] `pi-studio chat|loop|schedule` are unknown commands.

## Test / verification plan
- `npx vitest run packages/server/src packages/cli/src`
- `npm run build:server && npm run build:cli && npm run build:protocol`
