# Task 004 — Sprint close: gates, docs, TODO(verify) resolution

- **Sprint:** sprint-071-conversation-fork-daemon
- **Status:** done
- **Type:** docs
- **Area:** repo-wide docs + verification
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003

## Goal

Close the daemon half of conversation fork: full root gates green, every doc that describes the
changed surfaces updated, and the spec's daemon-side TODO(verify) items resolved with real answers.

## Context / why

The repo's convention is that docs are deliverables shipped with the change, not follow-ups (root
`AGENTS.md` § Docs sync on code changes). This sprint changes a protocol advertisement
(`forkTimelineSync` added, `rewind` removed), adds a daemon-internal surface (`resetTimeline`), adds
a passthrough push family member (`agent_timeline_reset`), and deletes a handler file — all of which
are documented in package `AGENTS.md` files that would otherwise contradict the code.

## Scope references

- `swe/features/conversation-fork.md` § Acceptance criteria, § TODO(verify)
- `packages/server/AGENTS.md` — agent subsystem, timeline store, slash-command operations
- `packages/protocol/AGENTS.md` — server feature flags, passthrough push families
- `AGENTS.md` (root) — § Protocol overview's passthrough-push family paragraph
- `swe/sprints/PLAN.md` — sprint index + coverage

## What to build

- **Run the full root gates** (not the per-package subsets used inside tasks):
  `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- **Docs:**
  - `packages/server/AGENTS.md` — `resetTimeline` on `agent-service` (and why it exists next to
    `seedTimeline`'s no-op-if-exists behavior); `handleFork`'s post-fork resync + handle-change
    guard; removal of `rewind-rpc.ts` and `truncateBeforeMessage`.
  - `packages/protocol/AGENTS.md` — `forkTimelineSync` added to `SERVER_FEATURES`; `rewind` removed
    (with the "flags are advertisements, not schema" rationale); `agent.rewind.*` schemas retained
    but read by nobody.
  - Root `AGENTS.md` — add `agent_timeline_reset` to the passthrough-push family list alongside
    `checkout_status_update`/`file_changed`/`terminals_update`, noting it is broadcast to every
    session with an open `reason` string.
  - `swe/sprints/PLAN.md` — mark sprint-071's tasks done; keep the coverage section truthful.
- **Resolve the daemon-side TODO(verify)** in `swe/features/conversation-fork.md`: whether
  `persistSessionHandle` exposes the pre/post handle without an extra record fetch. Record the
  answer found in task-003 and tick the box (or restate it accurately if the answer differs).

## Out of scope

- Web-client docs and the live two-window E2E — those belong to sprint-072's close task, which is
  where a real browser is in the loop.
- The two client-side TODO(verify) items (mid-stream fork behavior, steered/queued messages in
  `get_fork_messages`) — they need the UI to observe, so they stay open for sprint-072.

## Acceptance criteria

- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass from the repo root.
- [x] Every doc listed above reflects the shipped code; no doc still claims `rewind` is advertised or
      that `truncateBeforeMessage` exists.
- [x] The spec's `persistSessionHandle` TODO(verify) item is resolved with the actual finding.
- [x] These spec acceptance criteria are demonstrably met: dev daemon + mock provider fork answers
      without wiping the timeline and emits no broadcast; `server_info.features` no longer advertises
      `rewind`; `rewind-rpc.ts` + `truncateBeforeMessage` are gone; `agent.rewind.*` schemas remain.

## Test / verification plan

- The four root gate commands above, each green.
- Re-read each touched `AGENTS.md` section against the diff to confirm no stale claim survives.
- Manual: start `npm run dev:daemon`, connect, and assert `server_info.features` contains
  `forkTimelineSync` and not `rewind`.

## Notes

Markdown is excluded from `oxfmt` (`.oxfmtrc.json` `ignorePatterns`), so doc edits need no format
pass — but keep tables aligned by hand to match surrounding style.
