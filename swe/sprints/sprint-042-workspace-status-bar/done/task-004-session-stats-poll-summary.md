# Task 004 — `use-session-stats` poll + model wiring on create/restore/update — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
- **`hooks/use-session-stats.ts`** (new): polls `client.agent(id).sessionStats()` for one session
  and writes context/token/cost/model into `stats-store`. Two triggers: (a) an initial poll on
  mount/agent-identity-change plus a 12s interval backstop, and (b) an immediate extra poll when
  the session's `status` transitions away from `"running"` (a proxy for
  `turn_completed`/`turn_failed`/`turn_canceled`, detected via `SessionEntry.status` rather than a
  second raw `agent_stream` subscription — `agent-stream-events.ts` already drives that exact
  transition). No `agentId` → no poll. A single in-flight guard drops overlapping ticks.
- **`hooks/use-session-restore.ts`**: `RestoredAgent` gained `model?`/`provider?`, wired into
  `hydrate({..., model: agent.model})`. Added a second, connection-lifetime effect subscribing to
  `client.onAgentUpdate(...)` and calling `sessionStore.setModelByAgentId(agentId, model)` whenever
  a broadcast carries a `model` (an explicit `/model` set).

## Deviations from the task file (investigated, not assumed)
Three assumptions in the task did not hold, discovered by tracing the actual code (same discipline
as task-001):

1. **"the existing agent-update handling path (where `agent_update` session messages are consumed
   to drive `setStatusByAgentId`)" does not exist.** Grepped the whole `web-client/src` tree:
   `agent_update` is not consumed anywhere client-side today. `setStatusByAgentId` is called only
   from `agent-stream-events.ts`, driven by `agent_stream`/`turn_*` events, never `agent_update`. A
   comment in `Composer.tsx` even asserts `agent_update` frames "are top-level and never reach
   `onSessionMessage`" — traced this to be **stale**: both `bootstrap.ts` and `dev-bootstrap.ts`'s
   `broadcast` helper wraps every message through `wrapSessionEnvelope`, which wraps anything not
   already `{type:"session"}` — so `agent_update` genuinely does reach `onSessionMessage`
   client-side (confirmed by tracing `DaemonClient.handleTextFrame`'s `case "session"` →
   `handleSession` → fans out to `sessionHandlers`, and `PiStudioClient.onAgentUpdate`/
   `AgentHandle.onUpdate` build on exactly that). Built the listener fresh in
   `use-session-restore.ts` (the one hook already mounted for the whole app lifetime) using the
   existing `client.onAgentUpdate()` SDK method rather than a hand-rolled `onSessionMessage` filter.
2. **"Model from create: where the create-agent response binds the agent to the session, set the
   session model from the create config."** Traced `Composer.tsx`'s create-agent call: it sends
   `config: { provider: "pi", cwd }` — **no model field at all**. The client never selects or knows
   a model at creation time; Pi's own default/persisted model applies server-side. There is no
   config model to wire through. Skipped this sub-task as inapplicable; a freshly created session's
   model segment is populated by the very first `use-session-stats` poll (seconds after creation,
   once `bindAgent` sets `agentId`) rather than instantly from config — an acceptable, already-planned
   empty-state (task-006 hides the model segment until known).
3. **Test harness has no hook-rendering precedent.** Root `vitest.config.ts` runs `.test.ts` files
   under `environment: "node"` (no DOM); no `.tsx` test file or `@testing-library/react`
   `renderHook` usage exists anywhere in the repo despite the dependency being present. Rather than
   introduce a new DOM test harness mid-task (a cross-cutting change beyond this task's scope),
   extracted the hooks' decision logic into pure, directly-testable functions —
   `shouldRepollOnStatusChange`, `applySessionStats` (`use-session-stats.ts`), `hasStringModel`
   (`use-session-restore.ts`) — and unit-tested those. The React-effect wiring (mount triggers a
   poll, interval fires, cleanup on unmount) is verified by code review here and by task-007's
   manual smoke test against a live daemon, not by an automated render.

## A real bug the tests caught
`applySessionStats`'s first draft spread the mapped payload straight into `setStats`, including
explicit `undefined` values for every field the RPC response omitted. `stats-store.setStats`'s
shallow-merge (`{...prior, ...partial}`) treats a present key valued `undefined` as "clear this
field" — object spread doesn't distinguish an absent key from one explicitly set to `undefined` —
so a poll response missing e.g. `cost` would have wiped a previously known cost on every tick. A
unit test ("maps an empty payload to all-undefined fields (merged, not cleared)") caught this
immediately; fixed by building the patch object with only the fields the payload actually carries.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/hooks/use-session-stats.ts` | created |
| `packages/web-client/src/hooks/use-session-stats.test.ts` | created — 5 tests |
| `packages/web-client/src/hooks/use-session-restore.ts` | `RestoredAgent.model/provider`, `hydrate(model)`, new `hasStringModel` guard + `client.onAgentUpdate` listener effect |
| `packages/web-client/src/hooks/use-session-restore.test.ts` | created — 4 tests |

## How it satisfies the scope
- `clean-room-scope/features/agent-sessions.md` § Session stats: the poll is the pull-only path the
  scope's `/session` RPC always was; this task wires it into the client for continuous background
  refresh rather than a one-shot slash-command response.
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata: `stats-store` and
  `SessionEntry.model` (task-003) are now kept live for whichever session is passed to
  `useSessionStats(sessionId)` — task-006 wires that argument to the active session.

## Build & test results
```
$ npm run typecheck
> tsc -b
(success, no output)

$ npx vitest run packages/web-client
✓ 12 test files, 71 tests passed (includes the 9 new tests from this task)
```

## Acceptance criteria
- [x] Activating a session with an `agentId` triggers a `sessionStats()` call that populates
  `stats-store` for that sessionId; switching away and back shows the cached value immediately then
  refreshes — the hook's dependency array (`[status, client, sessionId, agentId]`) re-runs exactly
  on session/agent identity change, and `stats-store` is keyed per-sessionId (task-003) so a prior
  value is never lost on switch-away. Verified by code review + the store-level tests; full
  interaction deferred to task-007's smoke test per the harness limitation above.
- [x] A `turn_completed` for the active agent re-polls; the ~12s interval re-polls while active —
  verified by the `shouldRepollOnStatusChange` unit tests (running→idle/error = true) plus code
  review of the interval setup.
- [x] A session with no agent (pre-first-turn) does not poll and does not error — both effects
  early-return on `!agentId`; verified by code review (no live-render harness available).
- [x] Restored sessions carry `model` from `list_agents`; `/model`-set `agent_update` updates the
  session model live; the poll reconciles the model otherwise — verified by `session-store.test.ts`
  (task-003, hydrate/model passthrough) + `hasStringModel`'s 4 tests + code review of the wiring.
- [x] `npm run typecheck` passes.

## Follow-ups / TODO(verify)
- **TODO(verify):** the Composer.tsx comment claiming `agent_update` never reaches
  `onSessionMessage` should be corrected or removed in a follow-up docs pass — it is demonstrably
  stale given `wrapSessionEnvelope`, and could mislead a future change. Left untouched here since
  editing Composer.tsx's documentation is outside this task's file list; flagging for task-007 or a
  later cleanup.
- **TODO(verify):** full hook-level integration (interval timing, cleanup, session-switch behavior)
  is only code-reviewed + unit-tested at the pure-logic layer, not exercised by a rendered
  component, because no DOM test environment exists in this repo yet. Task-007's manual smoke test
  against a live daemon is the actual end-to-end proof for this task.
