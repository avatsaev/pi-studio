# Task 001 — `agent_timeline_reset` receipt + from-scratch timeline refetch

- **Sprint:** sprint-072-conversation-fork-ui
- **Status:** backlog
- **Type:** feature
- **Area:** web-client/stores, web-client/lib/protocol
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none in-sprint; requires s071/t003 (the daemon-side broadcast) to be shipped

## Goal

Make every connected client converge on the forked branch: on `agent_timeline_reset`, drop the
agent's cached rows and cursors and refetch its timeline from scratch, paging to completion.

## Context / why

This is the **convergence backbone** — the requester takes no bespoke refresh path, so a second
browser window, a relay-connected phone, and the initiating tab all converge through this one code
path. Built first because every later task in this sprint depends on it.

Post-fork hydrated rows carry **fresh epoch/seq numbering**, so any cursor a client holds from before
the fork is meaningless afterwards: clients must refetch from scratch (`cursor: null`), never
tail-sync.

## Scope references

- `swe/features/conversation-fork.md` § web-client: on fork completion (`onAgentTimelineReset`),
  § New broadcast: `agent_timeline_reset`, § Ground truth (fresh epoch/seq ⇒ no tail-sync)
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - After Fork.dc.html` § 08, § 09
- `packages/web-client/src/hooks/use-terminal-exit-watch.ts` — the passthrough-push consumption
  precedent (local type guard, no protocol union member)
- `packages/web-client/src/stores/session-store.ts` — cached rows + cursors per agent
- `packages/web-client/src/lib/protocol/timeline-paging.ts` — `fetch_agent_timeline` paging to
  completion (`hasNewer`)
- `packages/web-client/src/lib/protocol/events.ts` — timeline item flattening

## What to build

- A **local TypeScript interface + type guard** for the push (`{type: "agent_timeline_reset",
  agentId, reason}`) — mirroring `use-terminal-exit-watch.ts`. Do **not** add a protocol-package
  schema; this family is validated by the daemon's passthrough fallback by design.
- A listener (hook or store subscription, matching the existing pattern) that on receipt for
  `agentId`:
  1. drops that agent's cached timeline rows **and** cursors;
  2. refetches `fetch_agent_timeline` from scratch (`cursor: null`) and **pages to completion** —
     a single `direction: "after"` fetch returns the oldest page only (`timeline-paging.ts`'s own
     documented contract);
  3. clears any pending **optimistic** user rows for that agent (they belong to the abandoned
     branch).
- Ignore resets for agents this client has no cached timeline for (cheap no-op, no fetch storm).

## Out of scope

- The fork affordance, dialog, picker, prefill (later tasks).
- Reacting to `reason` values other than `"fork"` — treat the reason as opaque and always do a full
  reset, so `/new`/`/resume`/`/clone` work for free when the daemon starts sending them.

## Acceptance criteria

- [ ] On receipt, the agent's cached rows and cursors are dropped and a fresh `cursor: null` fetch
      runs, paging until `hasNewer` is exhausted.
- [ ] Pending optimistic user rows for that agent are cleared by the reset.
- [ ] A reset for an unknown/uncached agent is a silent no-op — no fetch issued.
- [ ] An unrecognised `reason` still triggers a full reset (reason is opaque).
- [ ] No cursor from before the reset is ever reused (verified by asserting the refetch starts null).

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Tests: store/reducer-level tests (Node, no jsdom — matching this package's existing convention) for
  each acceptance criterion, using the existing fake-client/scripted-daemon helpers as
  `agent-ui-store.test.ts` does. Run `npx vitest run packages/web-client`.
- Manual: with a real daemon, trigger a fork via a scripted `agent_fork_request` (no UI yet) and
  confirm the open transcript converges to the forked branch without a reload.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

Deliberately built before any UI so the convergence path is provable on its own, and so the fork
affordance later has nothing to special-case. Old clients lacking this handler ignore the push and
heal on their next full timeline fetch — degraded, not broken.
