# Task 005 — Cross-host Sessions & Schedules screens + Command center

- **Sprint:** sprint-013-app-navigation-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; task-004 (settings/sidebar footer icons); task-005 (sprint-012, keyboard infra)

## Goal
Implement the three global, cross-host aggregated screens reached from the sidebar footer
(`/open-project`, `/sessions`, `/schedules`) and the global command-center palette, correcting the
route model so Sessions/Schedules/Open-project are cross-host by default rather than per-host.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Route map (cross-host vs per-host tiers),
  § Open-project (host home), § Sessions (cross-host), § Schedules (cross-host), § Command center
- `clean-room-scope/features/schedules-heartbeats.md` (daemon cadence/target/run semantics)
- `clean-room-scope/features/keyboard-shortcuts.md` (command-center toggle binding)

## What to build
- `/open-project` (global): the same "home" tiles screen as the per-host variant, without a fixed host
  context — host selection happens inside the "Add a project" flow.
- `/sessions` (global): aggregated agent/session history across all connected hosts, with a host filter
  (hidden when ≤1 host), sorted by last-activity desc, an origin-host column when "All hosts" is
  selected, loading/error/empty/pull-to-refresh/load-more states. Redirect the legacy
  `/h/[serverId]/sessions` route to `/sessions` (COMPAT).
- `/schedules` (global): aggregated schedules table across all hosts — host filter (hidden when ≤1
  host) + status `SegmentedControl` (Active/Ended); per-row resolution of `{ bucket, target, state }`
  gated per-host on that host's own agent-directory readiness (not the aggregate loading flag, to
  avoid a slow host's schedules briefly reading as "target gone"); a create/edit form sheet covering
  name, cadence (cron/interval/once), target (new-agent w/ provider config, or existing agent), prompt,
  `maxRuns`/`expiresAt`.
- Command center: a global fuzzy-search palette (modal desktop/web, bottom sheet native/compact) listing
  aggregated agents (title/cwd match, ranked needs-input → attention → running → recency) plus static
  actions (New agent, Home, Settings); keyboard nav (arrows/enter/escape); focus-restore on close; bound
  to its keyboard shortcut from the sprint-012 keyboard infra.
- Update the sidebar's Sessions/Schedules/Home footer icons to link to the new global routes.

## Out of scope
- The daemon-side schedules RPCs themselves (already specced in `schedules-heartbeats.md`; this task is
  purely the client screens). Settings-section wiring (task-004).

## Acceptance criteria
- [ ] `/sessions` and `/schedules` aggregate correctly with zero, one, and many connected hosts.
- [ ] The legacy `/h/[serverId]/sessions` route redirects to `/sessions`.
- [ ] Schedules create/edit correctly round-trips cadence/target/prompt/maxRuns/expiresAt against the
      daemon's schedule RPCs.
- [ ] A schedule targeting an agent on a still-loading host is not shown as "target gone" prematurely.
- [ ] The command center lists/searches/ranks agents across hosts, activates a selection, and restores
      focus to the previously-focused element on close.

## Test / verification plan
- Tests: `npx vitest run` for aggregation across N hosts (0/1/many), schedule row resolution/bucket
  derivation, command-center search ranking + focus-restore, legacy-route redirect.
- Manual: with two mock hosts connected, open Sessions/Schedules/Command-center and confirm cross-host
  rows appear correctly labeled by origin host.

## Notes
- This task corrects a route-model drift from the original app-navigation-screens.md draft (which
  modeled Sessions/New-workspace as strictly per-host); treat the cross-host tier as canonical.
