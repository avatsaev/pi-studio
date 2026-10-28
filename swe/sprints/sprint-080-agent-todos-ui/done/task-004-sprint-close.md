# Task 004 — Sprint close: live verification (dev, real Pi, relay), docs, full gates

- **Sprint:** sprint-080-agent-todos-ui
- **Status:** done
- **Type:** test + docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003

## Goal

Prove the panel against real traffic on every transport, land the docs, and finish with green gates.

## Context / why

Task-003 verified the UI against the mock. U9 and U11 need an old-daemon check, real rpiv-todo
traffic and the relay path, which is how sprints 065, 068 and 072 closed.

## Scope references

- swe/features/agent-todos-ui.md § Acceptance criteria (U1–U11), § TODO(verify)
- sprint-079 task-009's real-Pi recipe (disposable homes, `core` pack, real model)
- Root AGENTS.md § Protocol overview (the `agent_todos_*` bullet sprint-079 added)

## What to build

Record each live step below in the summary with its observed result and screenshots, or mark it
not-run with the reason.
1. **Old daemon (U9):** an older daemon build (a sprint-078 checkout or one built with
   `agentTodos` removed) shows no panel and sends zero `agent_todos_*` frames (DevTools WS log).
2. **Real Pi (U11):** a prompt that makes the model plan with the `todo` tool. The panel appears and
   updates live as the model progresses. Then:
   - a page reload restores the list;
   - a daemon restart with a reconnect restores the list, and seq resets cleanly with no stuck
     panel;
   - a fork to before the todos replaces the list;
   - archiving the agent clears the panel.
3. **Relay (U11):** one window direct and one relay-connected on the same agent; both panels
   converge on every update.
4. **Docs:**
   - `packages/web-client/AGENTS.md` gains an "Agent todos panel" invariant: placement; visibility
     rules; that the collapse record is `pi-studio-agent-todos-ui`, agentId-keyed and capped at
     500; the reconnect refetch; plain-text-only; and in-panel scroll only.
   - Root `AGENTS.md`: the `agent_todos_*` bullet notes that sprint-080 shipped the consumer.
   - `swe/features/agent-todos-ui.md`:
     - status: shipped;
     - the TODO(verify) items resolved: the persistence slot, plus the visual sign-off outcome;
     - the i18n amendment applied.
   - `swe/MAIN-SCOPE.md` § 10 updated; PLAN.md sprint-080 status.

## Out of scope

- Any new feature work

## Acceptance criteria

- [ ] Steps 1–3 recorded with observed results
- [ ] User visual sign-off recorded (or the requested changes made)
- [ ] Docs updated as listed
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check` (changed files),
  `npm test` green

## Test / verification plan

- Live steps above; full gates
