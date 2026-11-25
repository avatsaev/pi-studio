# Task 003 — Workbench: status from `agent_update`, and a composer that is busy from acceptance

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (chat composer, session status)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-151/task-003, task-001

## Goal
With answers that arrive at once, the workbench still shows the right state at every moment: busy from
the accepted send until the turn ends, the reason when a send is refused, and the reason when a turn
fails.

## Context / why
The composer relied on the send promise staying pending for the whole turn (`composer-busy.ts`). The
workbench takes an agent's status only from the stream's `turn_*` events and ignores
`agent_update.status`, so a prompt an extension handles inline, or a failure before the turn starts,
never changes what it shows. Any rejected send is marked failed and its reason is thrown away.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract" (points 1, 3, 5)
- `packages/workbench/src/features/chat/Composer.tsx` (`submit` :459-552, `sending`/`steering`
  :168-174, the catch :539-548, header comment :1-60), `composer-busy.ts`
- `packages/workbench/src/hooks/agent-stream-events.ts` (:36-53), `use-agent-stream.ts` (:21-29),
  `use-session-restore.ts` (:110-125, the only `agent_update` consumer), `use-session-resync.ts`
- `packages/workbench/src/timeline/reducer.ts` (:322-338, :447-466), `stores/materialize.ts`
- `packages/workbench/AGENTS.md` ("Steering (mid-turn injection)" :1612-1626, the fork note :3036),
  `swe/features/composer-ui.md` (Steering)

## What to build
- **One status rule.** A pure function decides an agent's status from both sources, the stream's
  `turn_*` events and `agent_update.status`; both arrive in order on one socket. `agent_update` with
  `running`, `idle` or `error` is applied to the session store.
- **Busy from acceptance.** `sending` covers the request only. When the send is accepted the session
  is `running` until a settle arrives, so a second send cannot slip in between the answer and the
  first event. The steer path is unchanged.
- **A refused send** (`busy`, unknown agent, connection lost before the answer) marks the message
  failed and shows the reason in a toast.
- **A failed turn** shows its reason: check that the `turn_failed` row renders `error`, and fix it if
  it does not (this view has never been checked).
- Remove the comments that describe the blocking RPC; update the two docs above.

## Out of scope
The connection timeout (task-004). The browser check (task-005).

## Acceptance criteria
- [ ] Tests of the status function: a normal turn; a handled slash command (`running` then `idle`, no
      `turn_*`); a failure before the turn (`turn_failed` and `agent_update error`); a cancel.
- [ ] Composer tests: accepted → busy until the settle; refused → not busy, the message failed, the
      reason surfaced.
- [ ] After a reconnect the status comes from the resync as today (existing tests pass).

## Test / verification plan
- `npx vitest run packages/workbench`
- `npm run build:workbench`
