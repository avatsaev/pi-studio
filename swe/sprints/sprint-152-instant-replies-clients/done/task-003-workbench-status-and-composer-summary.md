# Task 003 — Workbench: status from `agent_update`, and a composer that is busy from acceptance — Summary

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
One pure status rule, `nextAgentStatus(current, signal)` in `packages/workbench/src/lib/agent-status.ts`: `turn_started` and the daemon's answer to an accepted send set `running`; **only `agent_update` (`running`, `idle`, `error`) ends a turn** (`turn_completed`, `turn_canceled` and `turn_failed` no longer touch the status, so a send in the gap before the daemon releases its claim cannot be refused as busy); `initializing`, `closed` and an update with no change are ignored. The session store applies it through `applyStatusSignal` / `applyStatusSignalByAgentId`; `agent_update` goes through the new `applyAgentUpdate` in `use-session-restore.ts`; a reconnect still takes the status from the agent list. The Send path moved to `features/chat/composer-send.ts` (`sendPrompt`): it materializes the draft, sends, and on acceptance the session is `running`, so Steer is offered. A refused send (busy, unknown agent, lost connection, failed materialize) marks the message failed and toasts the reason. The `turn_failed` row renders its reason (pinned by a test; `.errorCard` wraps long text). `ensureMaterialized` no longer re-rejects as an unhandled rejection when a draft fails to materialize (regression test).

## Files changed
New `lib/agent-status.ts`, `features/chat/composer-send.ts`, `rows/ErrorRow.test.ts` (+ tests); edited `Composer.tsx`, `composer-busy.ts`, `rows.module.css`, `hooks/agent-stream-events.ts`, `use-session-restore.ts`, `stores/session-store.ts`, `materialize.ts`, `timeline/reducer.ts`, several stale comments, and their tests; docs `packages/workbench/AGENTS.md` ("Send and busy", "One status rule"), `swe/features/composer-ui.md`.

## Build & test results
```
npx vitest run packages/workbench -> 153 files, 2026 passed; build:workbench, tsc -b packages/workbench OK; oxfmt/oxlint clean
```
Status consumers checked by grep (composer, stop button, progress bar, sidebar and tab dots, fork and compact gates, context meter, stats re-poll, auto-scroll, todos, extension dialogs): none needs `turn_completed` to flip the status.

## Acceptance criteria
- [x] Status function tests: normal turn, handled slash command (`running` then `idle`, no `turn_*`), failure before the turn, cancel
- [x] Composer tests: accepted, busy until the settle; refused, not busy, message failed, reason surfaced
- [x] Reconnect status from the resync as before (existing tests pass)

## Follow-ups / TODO(verify)
- When another client archives a running agent, the daemon skips the settle `agent_update` (the closed-agent path), so the other window's copy stays `running`. The workbench has never handled `agent_archived` / `agent_deleted` for that case; left as is.
- The failed dot now appears at `agent_update error`, a moment after the `turn_failed` row.
- `connection-store.ts` still sets the 30-minute request timeout (task-004).
- Not seen in a browser yet (sprint-152/task-005).
