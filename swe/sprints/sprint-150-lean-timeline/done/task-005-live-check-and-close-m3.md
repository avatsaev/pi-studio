# Task 005 — Live check of the lean timeline, and close of M3

- **Sprint:** sprints/sprint-150-lean-timeline
- **Status:** done
- **Type:** test
- **Area:** packages/server, docs
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-004

## Goal
History seen working across a restart on a real Pi, the gates green, and the docs and the handoff up to
date.

## Context / why
Run on a throwaway daemon (temporary `PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME`, a spare port). Credentials:
copy **only** the `litellm` entry (an API key) of the owner's Pi `auth.json` and its provider definition;
never the OAuth entries (Anthropic or Copilot): a refresh in the copy can invalidate the owner's own
token (this happened once in sprint-149/task-005).

## Scope references
- `docs/daemon-audit-handoff.md` § Approved improvements (row 3), § Milestones (M3)

## What to build
Run and record:
1. A conversation of several turns; stop the daemon; start it; send a message first, then fetch the
   timeline: earlier history, then the new turn (task-001).
2. A long turn: the stored rows per message (count through the dev tooling or a debug read), and the
   daemon's memory flat across several turns.
3. Archive and delete an agent: its history is no longer held (heap or registry size), archived history
   still fetches.
Docs: root `AGENTS.md` and `packages/server/AGENTS.md` (timeline: merged rows, eviction, no
`record.timeline`); `swe/features/timeline-streaming.md` if it describes per-chunk rows. Mark
`architecture/agent-timeline-persistence.md` "Not adopted (2026-11-25)" at its top with the reason, and
change improvement 3 and M3 in the handoff and `PLAN.md`. Full gates: `npm run build`, `npm run
typecheck`, `npm run lint`, `npm test`.

## Acceptance criteria
- [ ] All three recorded; gates green.

## Test / verification plan
As above.
