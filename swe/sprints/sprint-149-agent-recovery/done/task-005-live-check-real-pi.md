# Task 005 — Live check with a real Pi, and docs

- **Sprint:** sprints/sprint-149-agent-recovery
- **Status:** done
- **Type:** test
- **Area:** packages/server, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
The recovery behaviour seen on a real `pi --mode rpc`, and the docs say how agents now fail and recover.

## Context / why
Unit tests use fake transports; Pi's real exit and stdin behaviour must be seen. Run in the
orchestrator's session on a throwaway daemon: temporary `PI_STUDIO_HOME`, a temporary
`PI_STUDIO_PI_HOME` holding a copy of the owner's Pi `auth.json` (never the owner's directory
itself), a spare port. A few real turns cost a few tokens.

## Scope references
- `docs/daemon-audit-handoff.md` § Approved improvements (row 2), § 13 (open question: does Pi exit
  when its stdin closes)

## What to build
Run and record:
1. `kill -9` the agent's Pi mid-turn: the CLI/workbench shows the turn failed with the reason; the
   next message is answered in the same conversation.
2. Two sends at once: one `busy`.
3. `pgrep -f 'mode rpc'` count before and after: resume over a live agent, archive a running agent,
   `daemon stop`. No leftovers.
4. SIGKILL the daemon itself: do its Pi children exit (stdin EOF)? Record the answer in the handoff's
   open questions.
Docs: `packages/server/AGENTS.md` (agent lifecycle: busy rule, recovery, timeouts), `packages/cli`
docs for the busy message; mark M3 part 1 done in the handoff and `PLAN.md`.

## Acceptance criteria
- [ ] All four recorded with what was seen.

## Test / verification plan
As above; `npm run build:server` first.
