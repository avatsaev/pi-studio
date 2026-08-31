# Task 004 - Sprint close (gates + docs + TODO(verify) resolution) - Summary

**Sprint:** sprint-071-conversation-fork-daemon
**Completed:** 2026-08-26
**Status:** done

## What was implemented

Closed sprint-071: verified the full root gates against the tasks-001-003 changes, wrote/repaired
the doc-sync pass across `AGENTS.md` (root, `packages/server`, `packages/protocol`) and
`swe/sprints/PLAN.md`, resolved the one TODO(verify) scoped to this sprint, and live-verified the
two daemon-only acceptance criteria against a real running dev daemon + mock provider.

## Files created / changed

- `AGENTS.md` - extended the `terminals_update` passthrough-push paragraph in § Protocol overview
  with a new sentence describing `agent_timeline_reset` (sprint-071, `handleFork`): broadcasts to
  every active session on a handle-changed fork, `reason` currently always `"fork"`, and that a
  cancelled fork emits neither the reset nor the broadcast.
- `packages/protocol/AGENTS.md` - updated the `SERVER_FEATURES` export-table row to list
  `forkTimelineSync` (in place of the removed `rewind`); added a note after the
  `agentRewindRequestSchema`/`agentRewindResponseSchema` rows stating the `agent.rewind.*` schemas
  are retained but unread (daemon-side handler and `truncateBeforeMessage` deleted in task-001,
  kept on the wire per the append-only rule); added a `agent_timeline_reset` passthrough-push
  paragraph next to `provider_auth_flow_event`'s, describing the wire shape, the handle-changed
  guard, and the client contract (drop cached timeline, refetch from scratch).
- `packages/server/AGENTS.md` - updated the source-layout `bootstrap.ts`/`ws-server.ts` bullets to
  drop the removed `rewind-rpc.ts` reference; added `resetTimeline` to `agent-service.ts`'s bullet
  and a dedicated bullet describing `handleFork`'s post-fork resync (handle-changed guard, resync
  order, cancelled-fork no-op) to the Agent subsystem section, right after the existing
  `new_session`/`switch_session`/`fork`/`clone` REBIND bullet it extends.
- `swe/sprints/PLAN.md` - added a `> **Status:** COMPLETE` line to the sprint-071 section (matching
  the `sprint-039` convention), naming all 4 tasks done and the root gates green.
- `swe/features/conversation-fork.md` - ticked the two daemon-only acceptance criteria ("Dev
  daemon + mock provider: fork RPC answers, timeline is not wiped, no broadcast emitted" and
  "`server_info.features` no longer advertises `rewind`...") with a live-verification note each;
  resolved the `persistSessionHandle` pre/post-handle TODO(verify) with the answer task-003 already
  implemented. The remaining acceptance criteria (hover affordance, dialog/picker, composer
  prefill, relay-transport UI check) and the other two TODO(verify) items (Pi's mid-stream fork
  behavior, steered/queued message ordinal correlation) are explicitly out of scope for this
  sprint - they belong to sprint-072 (web-client).

## How it satisfies the scope

Task-004's scope (`task-004-sprint-close.md`) required: full root gates green; docs updated across
server/protocol/root `AGENTS.md` + `PLAN.md` describing `resetTimeline`, the `handleFork` resync,
the `agent_timeline_reset` push family, and the `rewind` removal; and the `persistSessionHandle`
TODO(verify) resolved. All four are done, plus a live daemon smoke test (not just the existing unit
tests) confirming the daemon-only acceptance criteria for real before ticking them.

## Build & test results

- `npm run build`: succeeded (protocol, client, server, highlight, relay, web-client, cli all
  build clean; only pre-existing chunk-size warnings on `web-client`'s Vite build, unrelated).
- `npx tsc -b --force`: clean, zero errors (forced to bypass any stale `.tsbuildinfo`).
- `npm run lint`: exit 0, zero errors; the touched files (`client-capabilities.ts`,
  `agent-service.ts`, `slash-command-operations.ts`, `slash-command-ops.test.ts`,
  `timeline-store.ts`, `timeline-store.test.ts`, `agent-service.test.ts`, and the deleted
  `rewind-rpc.*`) produced no warnings; all warnings in the full lint output are pre-existing and
  in unrelated files.
- `npm test`: 197 test files, 2617 tests, all passed.
- **Manual live verification** (`node`, real dev daemon `packages/server/dist/daemon/dev-main.js`
  + mock provider, real `@av-pi-studio/client` SDK over a real WebSocket):
  - `server_info.features.forkTimelineSync === true`; `"rewind" in server_info.features === false`.
  - Created a mock agent, sent a prompt, fetched the timeline (4 rows), called
    `handle.fork("some-entry-id")` -> `{ text: "mock forked text for some-entry-id", cancelled:
    false }` (the mock provider's stub, which does not rebind the persistence handle), re-fetched
    the timeline (still 4 rows, unchanged), and confirmed no `agent_timeline_reset` message was
    ever broadcast to the connected session. Matches the documented "mock-provider inert stub keeps
    the same handle -> no resync" behavior exactly.

## Acceptance criteria

- [x] Given the tasks-001-003 changes, when `npm run build`/`typecheck`/`lint`/`test` run from
      root, then all four gates pass.
- [x] Given `packages/server/AGENTS.md`, `packages/protocol/AGENTS.md`, and root `AGENTS.md`, when
      read after this task, then each accurately describes `resetTimeline`, the `handleFork`
      resync, the `agent_timeline_reset` push family, and the `rewind` removal.
- [x] Given `swe/sprints/PLAN.md`, when read after this task, then the sprint-071 section is marked
      complete.
- [x] Given `swe/features/conversation-fork.md`'s TODO(verify) section, when read after this task,
      then the `persistSessionHandle` item scoped to this sprint is resolved with the concrete
      answer found during task-003's implementation.

## Follow-ups / TODO(verify)

None remaining for this sprint. The two TODO(verify) items left open in
`swe/features/conversation-fork.md` (Pi's mid-stream fork behavior; steered/queued message ordinal
correlation) and the acceptance criteria touching the web-client (hover affordance, dialog/picker,
composer prefill, relay-transport UI check) are sprint-072's scope, not this sprint's.
