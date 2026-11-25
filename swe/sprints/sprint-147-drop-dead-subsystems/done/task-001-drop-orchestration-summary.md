# Task 001 — Drop chat rooms, loops and schedules — Summary

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Deleted `packages/server/src/orchestration/` (chat, loop, schedule services, cron, tests) and `daemon/orchestration-rpc.ts`; removed the executors and wiring from `daemon/bootstrap.ts`, the `schedule_list_request` stub from `dev-bootstrap.ts`, `onRecoverLoops` from `agent-manager.ts`, the schedule/loop/chat schemas and stores and `createQueuedJsonWriter` from `persistence/` (`STORE_SUBDIRECTORIES` is now `["agents","projects"]`; old folders on disk are left alone), and the `chat`/`loop`/`schedule` groups from the CLI's `feature-commands.ts`. Docs: root `AGENTS.md`, `CONTRIBUTING.md`, server and CLI `AGENTS.md`/`README.md`, `docs/gateway-architecture.md`, fern pages; the three `swe/features/` specs and their `MAIN-SCOPE.md` rows are marked retired.

## Files created / changed
Many deletions under `packages/server/src/orchestration/`; modified `daemon/bootstrap.ts`, `dev-bootstrap.ts`, `agent/agent-manager.ts`, `persistence/{atomic-store,entity-schemas,entity-stores}.ts`, `server/src/index.ts`, `protocol/src/messages.ts` (comment), `cli/src/feature-commands.ts`; one added CLI test asserting the groups are absent; docs as above.

## Build & test results
```
$ npx vitest run packages/server/src packages/cli/src   -> 133 files, 1898 passed
$ npm run build:protocol && build:server && build:cli   -> success
$ Wave gate (full tree, once, after tasks 001 and 003): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 326 files, 4682 tests, all passed; `oxfmt --check` on all changed source files clean.
```

## Acceptance criteria
- [x] No `ScheduleService`, `LoopService`, `ChatService`, `chat_`, `loop_`, `schedule_` RPC reference in `packages/*/src` outside the absence test (grep)
- [x] `pi-studio chat|loop|schedule` are unknown commands (checked through the registration test, not by running the binary)

## Follow-ups / TODO(verify)
- Desktop Rust, workbench, SDK, fern and the external fixtures had no use of these families (grep).
