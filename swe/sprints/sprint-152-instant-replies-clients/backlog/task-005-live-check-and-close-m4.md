# Task 005 — Live check of instant replies, and close of M4

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Status:** backlog
- **Type:** test
- **Area:** all packages, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-004, sprint-151/task-004

## Goal
M4 seen working with a real Pi, in the CLI and in the workbench, and the docs and the handoff brought
up to date.

## Context / why
Run on a throwaway daemon (temporary `PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME`, a spare port); never the
owner's daemon. Credentials: copy only the `litellm` entry (an API key) of the owner's Pi `auth.json`
and its provider definition, never the OAuth entries. The workbench is checked in a real browser (the
Vite dev server needs `PI_STUDIO_DEV_ALLOWED_ORIGINS`), not in jsdom.

## Scope references
- `docs/daemon-audit-handoff.md` § "M4 contract", § Approved improvements (row 4), § Milestones (M4)

## What to build
Run and record:
1. **CLI.** `run` prints the id at once and exits after the turn; `--no-wait`; `wait`; a failed turn
   (a model that does not exist) exits non-zero with the reason.
2. **A turn longer than 30 s** (a tool call that sleeps 45 s): no false error in the workbench.
3. **Workbench.** A new conversation appears at once; the composer is busy until the turn ends; a
   second send from another tab is refused with the reason shown; a prompt Pi refuses (no credential)
   shows a failed row with the reason; a slash command an extension handles inline leaves the
   conversation idle; reloading the page mid-turn shows the right end state.
4. **A dropped connection.** The client's socket is killed mid-turn; after the reconnect the turn's
   result is there.
Docs: root `AGENTS.md`, the handoff (improvement 4 and M4 marked done, § A7), `PLAN.md`. Full gates:
`npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, and `cd desktop && cargo xtask ci`
(the workbench changed).

## Acceptance criteria
- [ ] All four recorded with what was seen, and what was not checked named.
- [ ] Gates green.

## Test / verification plan
As above.

## Notes
`swe/features/mcp-server.md` describes a server removed in M2; remove it here if nothing links to it.
