# Task 004 — End-to-end verification of both failure modes + docs sync

- **Sprint:** sprint-050-connection-resilience
- **Status:** done
- **Type:** test + docs
- **Area:** packages/web-client, packages/client, clean-room-scope
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003

## Goal

Prove the two failure modes this sprint exists to fix are actually fixed, against a real daemon in a
real browser — then sync the docs and close the spec's open items.

## Context / why

Every automated test in this sprint runs in Node with no DOM: the Worker path (task-002) and the
`visibilitychange`/`online` wiring (task-003) are structurally not unit-testable in this repo. The
pure cores are covered, but *the actual behavior the sprint promises has no automated proof.* This
task is where that proof is produced. Without it the sprint would ship on inference.

## Scope references

- `clean-room-scope/features/connection-resilience.md` § Test / verification plan (live smoke test
  items 1–3); § Acceptance Criteria; § TODO(verify)
- `packages/web-client/AGENTS.md` — docs sync (new `lib/connection/` modules)
- `packages/web-client/src/lib/connection/{worker-timers,resume-action,resume-triggers}.ts` — under test
- `packages/client/AGENTS.md` — confirm task-001's entry is present and accurate

## What to build

No new product code. Deliverables are evidence and documentation.

**1. Live verification** against a real daemon (`npm start`, web-client via `npm run dev` or a
built bundle). Record the observed result for each scenario — an actual observation, never an
expectation restated:

- **Throttled-tab reconnect.** Connect, hide the tab (other window focused, not just occluded) for
  ≥ 6 minutes to clear Chrome's intensive-throttling threshold. Kill the daemon, restart it. With
  the tab still hidden, confirm from the daemon log / devtools network panel that the client
  reconnects within a backoff rung, not on a ~60 s boundary. Then refocus and confirm the UI is live
  with no user action.
- **Stale socket after sleep.** Connect over Wi-Fi, sleep the machine ≥ 5 minutes (long enough for
  NAT state to lapse), wake, focus the tab. Confirm: a `ping` goes out, no `pong` returns, the socket
  closes with code 4000, a reconnect follows, and the UI is live — all within a few seconds and with
  no RPC needed to trip detection.
- **Disconnect is never resurrected.** Click Disconnect, then alt-tab away and back several times
  and toggle network off/on. Confirm no reconnect attempt is made (no WS traffic).
- **Regression sweep.** Normal connect, agent turn streaming, a terminal session, and a file
  download still behave — the timer swap touches the connection lifecycle every feature rides on.

**2. Docs sync** (repo rule — same change, not a follow-up):

- `packages/web-client/AGENTS.md`: add the three `lib/connection/` modules to the source-layout list
  with one-line responsibilities; document the resume-trigger contract (which signals, what each
  does, the never-resurrect-a-disconnect rule) and the `PROBE_TIMEOUT_MS` / close-code 4000
  convention.
- Verify `packages/client/AGENTS.md` carries task-001's `reconnectNow()` entry.

**3. Close spec items** in `clean-room-scope/features/connection-resilience.md`:

- Tick the § Acceptance Criteria boxes that live verification proved; leave any that were not
  actually exercised unticked with a one-line note.
- Resolve or re-scope the two § TODO(verify) entries: the CSP one was answered during planning (no
  CSP in `docker/web-client.nginx.conf.template` — fold in task-002's finding); for the
  Safari/Firefox worker-throttling one, either verify in those browsers and record the result, or
  restate it as a known-unverified limitation. Do not silently drop it.

## Out of scope

- New product behavior of any kind. If verification uncovers a defect, fix it under this task only
  if it is small and clearly in-sprint; otherwise open a follow-up task in `backlog/` and record it
  here.
- Electron `powerMonitor` wiring (belongs to the desktop sprint; see the spec's § Relationship to
  the desktop shell).

## Acceptance criteria

- [ ] All four live scenarios executed, each with a recorded observation (what was seen, not what
      was expected).
- [ ] Full suite green: `npm test`, `npm run build`, `npm run typecheck`, `npm run lint`.
- [ ] `packages/web-client/AGENTS.md` documents the three new modules and the trigger contract;
      `packages/client/AGENTS.md` documents `reconnectNow()`.
- [ ] The spec's acceptance boxes reflect reality, and both TODO(verify) items are resolved or
      explicitly restated as unverified.
- [ ] A sprint summary records the evidence (this is the sprint's definition-of-done artifact).

## Test / verification plan

- Build: `npm run build`. Typecheck: `npm run typecheck`. Lint: `npm run lint`.
- Tests: `npm test` (full suite — the sprint's final gate).
- Manual: the four scenarios above, against a real daemon in Chrome. Use the daemon log plus the
  devtools Network → WS panel as evidence; note the wall-clock reconnect latency in each case.

## Notes

- The sleep test needs a real sleep, not a simulated one — a devtools-offline toggle produces a
  clean `close` event, which exercises the *ordinary* reconnect path and proves nothing about the
  half-open case this sprint's probe exists for.
- If the throttled-tab scenario shows reconnects still landing on minute boundaries, the Worker
  fallback probably latched; check for a Worker construction error before touching the backoff code.
