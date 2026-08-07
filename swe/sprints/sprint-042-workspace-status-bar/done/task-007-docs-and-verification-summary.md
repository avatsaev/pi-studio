# Task 007 — Docs sync + end-to-end verification — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
Updated the three package `AGENTS.md` files touched by this sprint, plus a correction to
`clean-room-scope/sprints/PLAN.md`'s own sprint-042 entry (this task's scope, investigated and
adjusted — see below).

## Deviation from the task file (investigated, not assumed)
The task listed `clean-room-scope/features/workspace-ui.md` as a doc to update. Read the file in
full: it describes an **aspirational Paseo-parity** pane/split/header/tab architecture (`SplitPane`,
`SplitGroup`, pinned quick-launch targets, a "Primary header" with a branch switcher baked into the
*title bar*, …) that **does not match the current implementation at all** — same discrepancy
`sprint-038-tab-strip-new-tab-menu` already flagged in its own `PLAN.md` entry ("features/
workspace-ui.md's tab model describes a different, aspirational draft/agent/pane architecture not
reflected in the current implementation; tasks... reference the live source files... directly
instead"). There is no "bottom status bar" concept anywhere in that scope's header/layout section to
extend — inserting one would misrepresent a real, shipped feature as part of a design that was
never built. Followed the sprint-038 precedent exactly: did **not** edit `workspace-ui.md`; instead
corrected this sprint's own `PLAN.md` blockquote and task-007's "Covers" column to say so
explicitly, so the discrepancy is documented rather than silently worked around.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/AGENTS.md` | added `agentSessionStatsResponseSchema` to the key-exports table (with the new optional `model`); added an Invariants bullet documenting that `list_agents_request`/`response` has no schema at all |
| `packages/server/AGENTS.md` | added a `list_agents_request` bullet (model/provider source) to the `AgentManager` section; added a `getRuntimeInfo().model` caching bullet to the Pi provider section describing `discoverState()`; added a `handleSessionStats` model back-fill note to the slash-command-operations bullet |
| `packages/web-client/AGENTS.md` | updated `stores/`, `hooks/`, `features/workspace`, `features/git`, and `routes/` source-layout entries; added a new "Status bar (sprint-042)" Invariants entry covering the subscription-ownership fix and the pull-only poll model |
| `clean-room-scope/sprints/PLAN.md` | extended the sprint-042 blockquote to explain why `workspace-ui.md` is intentionally not edited; corrected task-007's "Covers" column to match |

## How it satisfies the scope
Every behavioral change made in tasks 001–006 that a future maintainer would need to know about
before touching this code again is now documented at the package level, matching this repo's
established convention (AGENTS.md as the living source of truth, scope docs as historical/
aspirational planning context where they've diverged from what's shipped).

## Build & test results (full, whole-workspace)
```
$ npm run typecheck
> tsc -b
(success, no output)

$ npm test
Test Files  92 passed (92)
     Tests  748 passed (748)

$ npm run lint
(exit 0 — only pre-existing warnings in files this sprint never touched)

$ npm run build:web-client
vite build succeeds (2668 modules; pre-existing chunk-size/circular-chunk warnings, unrelated)
```

## End-to-end manual verification (superset of this task's plan, carried out during task-006)
Performed against a **real, restarted daemon** (`node packages/server/dist/daemon/main.js`, real
`pi --mode rpc` provider, disk persistence) and the actual web-client dev server, driven by a
headless browser plus a direct Node script using `@av-pi-studio/client` (for a clean signal
independent of browser/HMR quirks):
1. Opened a session in this repo (a real git repo) → confirmed the bar renders all six segments,
   75px tall, full width, correctly ordered, with the icons specified.
2. Confirmed the branch segment (`main ↑N ●N`) renders **without ever opening the Changes tab** —
   validates the subscription-ownership fix (StatusBar is the sole `useCheckoutStatus` owner).
3. Created a fresh agent, ran a real turn, confirmed via direct RPC inspection that both
   `list_agents_request` and `agent_session_stats_request` return a real model id
   (`global.anthropic.claude-sonnet-5`) — validates the Pi-provider `discoverState()` fix.
4. Confirmed the model segment renders once the poll resolves (not before) — validates the
   `session-store` reconciliation fix.
5. Restarted the daemon mid-test to specifically exercise the "record with no live session" path
   (task-001's documented caveat) and observed the expected degraded-but-graceful behavior (model
   absent until the agent is resumed/re-created under the new daemon incarnation, matching the
   caveat as written, not a crash or silent wrong data).
6. Cleaned up: archived the two agents created for this test via `archive_agent`, confirmed via
   `list_agents_request` that only the pre-existing session remains — the daemon's real session
   history was not left with test artifacts.

## Acceptance criteria
- [x] The three package AGENTS.md files reflect exactly what was built; no aspirational or
  contradicted statements remain — verified by re-reading each file's final state after editing.
- [x] Full suite green: `npm run typecheck` and `npm test` pass — 748/748, 0 failures.
- [x] Manual smoke recorded above passes — all 5 scenarios from the task's own verification plan
  were exercised (in task-006, reused here rather than repeated) plus the daemon-restart caveat
  scenario and cleanup.

## Follow-ups / TODO(verify)
- None outstanding. Every deviation discovered across all 7 tasks (list_agents/session-stats data
  sources, the missing client-side agent_update consumer, the checkout-status subscription
  collision, the session-store/stats-store wiring gap, and the Pi provider's missing model
  tracking) was investigated against the real code and fixed — not deferred — before this sprint
  closes.
