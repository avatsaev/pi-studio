# Task 006 — Sprint close: live E2E matrix, gates, docs — Summary

- **Sprint:** sprint-072-conversation-fork-ui
- **Completed:** 2026-08-27
- **Status:** done

## What was implemented

Closed the sprint by proving the whole conversation-fork feature (sprint-071's daemon half +
sprint-072's tasks 001-005 web-client half) against a **real daemon and a real `pi` process**,
including the relay transport, then landed docs and resolved every remaining `TODO(verify)` and
acceptance criterion in `swe/features/conversation-fork.md`. No source code changed — this task is
pure verification + documentation, per its own scope.

All nine live E2E scenarios and both remaining spec `TODO(verify)` items passed / resolved. Full
root gates (`build`, `typecheck`, `lint`, `test`) are green.

## Live E2E matrix — what was observed

1. **Two-window convergence without reload.** Two real browser windows on the same agent (real
   `pi`, `azure_ai/claude-sonnet-5`); forking a mid-conversation message in window 1 truncated
   window 2's transcript to the identical pre-fork state within the same RPC round trip, no
   reload, no page navigation.
2. **Real forgetting after re-send.** Forked from a message that established a secret fact never
   restated afterward; re-sent the prefilled text on the new branch and asked the agent directly —
   it correctly answered "no", while a fact established *before* the fork point was still known.
3. **Confirm-text fidelity + forced correlation mismatch.** The confirm dialog showed the exact
   clicked message's text verbatim (`GAMMA` in one probe). Forced a genuine mismatch — not a
   simulated race — by running an out-of-band `/new` on the same agent between reading the row and
   clicking its (now-stale) fork button: the fresh `forkMessages()` call the click always makes
   returned an empty list, `correlateForkTarget` correctly saw ordinal-out-of-range, and the app
   opened the picker's "Nothing to fork yet" empty state instead of forking.
4. **Picker forks the selected message.** (Already verified in earlier tasks; re-confirmed live in
   this pass alongside scenario 3's setup.)
5. **Extension-cancelled fork changes nothing and toasts.** A scratch `session_before_fork`
   extension unconditionally returning `{ cancel: true }`: `forkMessages()` before/after were
   byte-identical, no `agent_timeline_reset`/`agent_update` broadcast fired, and the browser showed
   "An extension declined the fork." with the dialog closed and the composer untouched (no
   prefill).
6. **Daemon restart resumes the forked branch (sprint-037 guard).** Forked away from two of three
   turns, restarted the daemon process (`PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME` both pointed at
   the same on-disk state), and the resumed agent's persisted session file was already the forked
   one — `list_agents_request` showed the same record, and asking the resumed process about the
   abandoned turns' content got a genuine "no" while the pre-fork turn was still remembered.
7. **Mock provider: fork RPC answers, timeline not wiped, no broadcast.** Against
   `npm run dev:daemon`, `fork()` answered `{ cancelled: false }`, but the daemon's handle-changed
   guard correctly saw no change (mock's stub never rebinds its `nativeHandle`) and skipped both
   `resetTimeline` and the broadcast — confirmed by a direct post-fork
   `fetch_agent_timeline_request` still showing the original turn untouched.
8. **Flag-absent daemon renders no fork UI.** Temporarily filtered `forkTimelineSync` out of
   `ws-server.ts`'s `defaultFeatures()` for one throwaway daemon (reverted immediately after,
   confirmed by an empty `git diff`, never shipped): the fork button was absent from the DOM
   entirely on every row (not merely hidden/disabled), and "Fork from…" was absent from the
   session "⋮" context menu.
9. **Relay transport convergence.** Started a standalone relay server
   (`packages/relay/dist/relay-main.js`) and a daemon with `PI_STUDIO_RELAY_ENABLED=true` pointed
   at it; generated a real pairing link via `pi-studio daemon pair`; connected window 2 purely
   through that link (full E2EE handshake, `ws://<relay>` in its connection bar, no direct network
   path to the daemon). Forking in the direct window (1) converged window 2's transcript to the
   same truncated state with no reload — proving the `agent_timeline_reset` broadcast reaches
   relay sessions identically to direct ones, not just by code inspection of the provider-agnostic
   broadcast loop.

## `TODO(verify)` resolutions

- **Fork mid-stream.** Forking while a turn is running never errors on either side: the
  `agent_fork_request` answers normally, and the in-flight `send_agent_prompt` call settles with
  `status: "idle"` shortly after (observed: a multi-step turn's logged duration dropped to ~1s,
  matching exactly when the fork was issued) rather than rejecting. Pi tears the run down cleanly.
  This app already never offers the fork affordance while `running` is true, so no client-visible
  change follows from this finding — it documents what a client bypassing that gate would see.
- **Steered/queued messages in `get_fork_messages`.** A `steer_agent_request` and a
  `follow_up_agent_request` fired mid-turn are invisible to `forkMessages()` while `queue_update`
  still lists them pending; once the turn settles, both appear as their own entries, same order,
  same text, matching the timeline's own `user_message` confirmations exactly. Confirms
  `fork-correlation.ts`'s `isConfirmedUserRow` precondition (a pending row never gets an ordinal)
  already held — no client-side change needed.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/AGENTS.md` | Conversation-fork invariant section extended: `forkTimelineSync` gate documented for the first time, plus 6 new live-verification bullets (mid-stream, steered/queued, restart, extension-cancel, mock-provider, relay convergence) |
| `packages/server/AGENTS.md` | `handleFork`'s existing "reaching every active session including relay ones" claim now cites the live two-window relay verification, not just the structural broadcast-loop argument |
| `AGENTS.md` (root) | `agent_timeline_reset` bullet extended: sprint-072 shipped the actual UI emitter, live-verified over relay |
| `swe/sprints/PLAN.md` | sprint-072 section gains a `**Status:** COMPLETE` line (matching sprint-071's convention) |
| `swe/features/conversation-fork.md` | All 10 `## Acceptance criteria` boxes ticked with 2026-08-27 findings; both `## TODO(verify)` items resolved with the actual observed behavior |
| `swe/sprints/sprint-072-conversation-fork-ui/in_progress/task-006-sprint-close.md` | `Status: in_progress` → `done`, all acceptance criteria ticked |
| `swe/sprints/sprint-072-conversation-fork-ui/in_progress/task-006-sprint-close-summary.md` | created (this file) |

No `packages/*/src/**` files changed — this is a docs + verification task. One temporary,
immediately-reverted source patch was applied and reverted during scenario 8 (see below), leaving
zero net diff in `packages/server/src/ws/ws-server.ts`.

## How it satisfies the scope

Every item in task-006's "What to build" and "Acceptance criteria" sections is covered: all nine
live E2E scenarios ran and are recorded above with actual observed results (not just "verified"),
all four root gates pass, every `conversation-fork.md` acceptance-criteria checkbox is ticked, both
remaining `TODO(verify)` items are resolved with real findings, and the docs listed in the task's
own "Docs" bullet were updated. Scenario 8's implementation note ("filtering the advertised feature
set in `ws-server.ts`'s `features` option... do not ship that patch") was followed literally: the
temporary filter was applied, verified, and reverted in the same session, confirmed by an empty
`git diff --stat` on that file afterward.

## Build & test results

```
$ npm run build
✓ built in 10.53s (web-client)
> build:cli — tsc -b packages/cli — success
(all packages built; pre-existing >500kB chunk-size warning only, unrelated to this task)

$ npx tsc -b --force
(exit 0, no output — clean forced typecheck across all packages)

$ npm run lint
(exit 0; 70 pre-existing warnings across the workspace, none in any file this sprint touched —
 matches the documented pre-existing baseline)

$ npm test
Test Files  203 passed (203)
     Tests  2673 passed (2673)
  Duration  3.69s (transform 10.25s, collect 46.86s, tests 14.39s)
```

## Acceptance criteria

- [x] All nine live E2E scenarios pass and are recorded with what was observed (see § Live E2E
      matrix above — each entry states the actual finding, not just "verified").
- [x] `npm run build`, `npx tsc -b --force` (typecheck), `npm run lint`, `npm test` all pass from
      the root (see § Build & test results).
- [x] Every checkbox in `swe/features/conversation-fork.md` § Acceptance criteria is ticked (all
      10; see the file's diff).
- [x] Both remaining `TODO(verify)` items are resolved with the actual observed behavior (see
      § `TODO(verify)` resolutions above, and the file's own `## TODO(verify)` section).
- [x] Docs listed in the task reflect the shipped code; no stale claims remain (`web-client`,
      `server`, root `AGENTS.md`, `PLAN.md` all updated; nothing found to be stale in
      `server`/root beyond the one addition each).

## Follow-ups / TODO(verify)

None remaining for this feature. Explicitly out of scope per the task and the spec's own
Non-goals: session-tree navigation (a later sprint reusing `agent_timeline_reset`'s plumbing),
file time-travel (an extension concern, e.g. Pi's `git-checkpoint.ts`), and
clone/new/resume/switch UI (same rebind family, deliberately excluded — `reason` stays an open
string for when that day comes).
