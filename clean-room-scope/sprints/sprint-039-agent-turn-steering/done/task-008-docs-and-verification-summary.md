# Task 008 Summary — Docs sync + full verification

- **Status:** done
- **Verified:** `npm run build` (all 7 packages, dependency order), `npm run typecheck` (`tsc -b`
  across the workspace), `npm run lint` (oxlint — exit 0, only pre-existing warnings, none in touched
  files), `npx vitest run` (full suite — **86 files, 699 tests, all green**, up from 694 before
  sprint-039 started: +5 new reducer tests from task-007).

## What was done

Package `AGENTS.md` docs for protocol/server/client/cli were already updated when tasks 001–006
landed earlier this session (verified, not re-touched). This task closed the remaining gap:

- **`packages/web-client/AGENTS.md`**: added a "Steering (mid-turn injection)" bullet to
  `## Invariants` describing the Send→Steer swap, the `queued` flag/badge lifecycle, and that
  follow-up is intentionally SDK/CLI-only (not surfaced in this UI).
- **`clean-room-scope/features/agent-sessions.md`**:
  - Added "Steer a running turn" and "Queue a follow-up" rows to the "Other operations" table.
  - Added `queue_update` to the "Stream events" list with its shape.
  - Added a new "### Steering & follow-up (mid-turn injection)" subsection under Behavior &
    Algorithms: steer bypasses the normal turn-run path and never changes status; follow-up is
    distinct from "send while idle"; both broadcast a normal `user_message` row via the existing
    optimistic-echo contract; `queue_update` correlates by text, not id.
- **`clean-room-scope/features/composer-ui.md`**: added a "### Steering (web-client's implemented
  alternative to Queue's 'interrupt' behavior)" subsection distinguishing the shipped
  `steer_agent_request`-based mechanism from the doc's pre-existing (richer, not-yet-built-in-
  `web-client`) local queue-track/edit/send-now spec — cross-referenced both directions so a future
  reader doesn't conflate the two "queue" concepts.
- **`clean-room-scope/features/timeline-rendering.md`**: added `queued?` to the `user_message` row
  kind's field list (web-client only) and a sentence to the "User message" row-treatment bullet
  describing the "queued" pill.
- **`clean-room-scope/features/timeline-streaming.md`**: added a "Timeline model" bullet clarifying
  `queue_update` is an ephemeral live-stream-only signal, never a projected/persisted timeline item
  (no sequence number, never replayed via `fetch_agent_timeline_request`) — prevents a future
  implementer from expecting it in history/replay.

No `README.md` exists for `web-client` (or any touched package) — nothing to update there.

## Deviations from the task spec

- The original task-008 spec (written before tasks 001–006 were discovered already-implemented)
  listed all five `AGENTS.md` files as in-scope. Four of them (protocol/server/client/cli) were
  already correct from earlier this session — confirmed by reading each, not re-edited (editing
  already-correct docs would be pure churn).

## Sprint-039 final status

All 8 tasks done: 001–006 (protocol/provider/daemon/mock/SDK/CLI — implemented and tested earlier
this session), 007 (web-client Composer Steer swap + queued badge — implemented and verified this
session), 008 (docs — this task). `clean-room-scope/sprints/PLAN.md`'s sprint-039 entry should be
updated to reflect full completion (see follow-up note below).

## Notes

- **Incident during task-007 verification** (documented in full in
  `done/task-007-web-client-steer-composer-summary.md`): my own attempt to start a throwaway mock
  daemon for manual testing collided with the user's live production daemon on port 6767
  (`EADDRINUSE`), and their daemon separately went down mid-session (clean shutdown in its own logs,
  consistent with a `persist:false` hub-managed process being torn down by an unrelated concurrent
  session ending). Restarted it via `hub restart pi-studio-daemon`; it recovered its persisted agent
  state cleanly. All further verification ran against an isolated daemon on a different port.
