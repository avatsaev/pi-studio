# Task 006 — Sprint close: live E2E matrix, gates, docs

- **Sprint:** sprint-072-conversation-fork-ui
- **Status:** done
- **Type:** docs
- **Area:** repo-wide docs + end-to-end verification
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal

Prove the whole feature against a real daemon and a real `pi` process — including multi-client
convergence and the relay transport — then land the docs and close out the spec's remaining
TODO(verify) items.

## Context / why

Every claim in this feature is about **live process state** (the agent genuinely forgetting turns) and
**multi-client convergence**. Neither is provable by unit tests; both are acceptance criteria. The
repo's precedent for this kind of close is sprint-070/task-006 and sprint-065/task-007 (live E2E
including over relay).

## Scope references

- `swe/features/conversation-fork.md` § Acceptance criteria (all ten), § TODO(verify)
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec.dc.html` § 14 — acceptance checklist
- `packages/web-client/AGENTS.md`, `packages/server/AGENTS.md`, root `AGENTS.md`
- `swe/sprints/PLAN.md`

## What to build

**Live E2E matrix** (real daemon via `npm start`, real `pi`, real browser):

1. **Convergence:** fork a mid-conversation user message with **two browser windows** open on the
   same session — both transcripts truncate to before that message **without a reload**.
2. **Real forgetting:** the composer receives the original text; re-send it and confirm the agent
   demonstrably does not remember the abandoned branch.
3. **Confirm-text fidelity:** the confirm dialog always shows the exact text that will be forked
   from; force a correlation mismatch and confirm it opens the picker instead of forking.
4. **Picker:** "Fork from…" lists the active branch's user messages and forks the selected one.
5. **Extension cancellation:** an extension-cancelled fork changes nothing and toasts.
6. **Restart regression (sprint-037 guard):** restart the daemon after a fork — it resumes into the
   forked branch.
7. **Mock provider:** dev daemon (`npm run dev:daemon`) — fork RPC answers, timeline is **not**
   wiped, no broadcast emitted.
8. **Flag gating:** against a daemon without `forkTimelineSync`, **no** fork UI renders anywhere.
9. **Relay transport:** repeat (1) with one client connected over the relay — the broadcast reaches
   relay sessions.

**Gates:** `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` from the root.

**Docs:**

- `packages/web-client/AGENTS.md` — the fork affordance + dialog/picker, the ordinal-correlation rule
  and its text-verification fallback, the `agent_timeline_reset` receipt as the single convergence
  path, and the `forkTimelineSync` gate.
- `packages/server/AGENTS.md` / root `AGENTS.md` — only if sprint-071's close left anything stale.
- `swe/sprints/PLAN.md` — mark sprint-072 done; update the coverage section to state
  `features/conversation-fork.md` is shipped end to end across 071+072.

**Resolve the remaining spec TODO(verify):**

- Pi's exact behavior when `fork` arrives **mid-stream** (teardown aborts the run vs. error) — the
  client gates on `running` regardless, but confirm live and document the finding.
- Whether steered/queued user messages appear in `get_fork_messages` identically to how the timeline
  renders them as user rows (task-002's ordinal assumption).

## Out of scope

- Session-tree navigation (a later sprint) — do not build toward it here, though note that this
  sprint's `agent_timeline_reset` handler is the plumbing it will reuse.

## Acceptance criteria

- [x] All nine live E2E scenarios above pass and are recorded in the task summary with what was
      observed (not just "verified").
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass from the root.
- [x] Every checkbox in `swe/features/conversation-fork.md` § Acceptance criteria is ticked, or
      explicitly explained if not.
- [x] Both remaining TODO(verify) items are resolved with the actual observed behavior.
- [x] Docs listed above reflect the shipped code; no stale claims remain.

## Test / verification plan

- The nine scenarios, each executed manually against the real stack; capture the observed result per
  scenario.
- The four root gate commands.
- Re-read each touched `AGENTS.md` section against the diff.

## Notes

Scenario 8 needs a daemon that does not advertise the flag — easiest via a locally patched
`SERVER_FEATURES` build or by filtering the advertised feature set in `ws-server.ts`'s `features`
option, which exists for exactly this kind of override. Do not ship that patch.

Stop the dev servers before committing (project convention: no running dev server at commit time).
