# Task 007 — Docs sync + end-to-end verification

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006

## Goal
Update the affected AGENTS docs to describe the new wire fields, stores, hook, and component, then
verify the whole feature end-to-end against a live daemon.

## Background / why
Per the repo docs-sync rule, code changes to a package must update that package's `AGENTS.md` in the
same change. This sprint touched `protocol`, `server`, and `web-client`.

## Scope references
- `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/web-client/AGENTS.md`
- root `AGENTS.md` (protocol section — only if a listed wire field there is now stale)
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata

## What to build / do
- **`packages/protocol/AGENTS.md`**: note `list_agents_response` entries now carry optional
  `model`/`provider`, and `agent_session_stats_response.payload` carries optional `model`.
- **`packages/server/AGENTS.md`**: note both bootstraps populate `model`/`provider` on
  `list_agents`, and `handleSessionStats` back-fills `model` from runtime info.
- **`packages/web-client/AGENTS.md`**: add to the source-layout tree and prose — `stores/stats-store.ts`,
  `hooks/use-session-stats.ts`, `features/workspace/StatusBar.tsx` + `status-bar-format.ts`, the
  `git-store` branch-meta retention, `SessionEntry.model`, and the bottom status bar in the shell
  layout description. Note the status-bar model is poll-authoritative (self-correcting) with
  `agent_update` for instant `/model`-set feedback, and that context/tokens/cost are pull-only.
- **`clean-room-scope/features/workspace-ui.md`**: add/extend a § describing the bottom status bar
  (segment order, data sources, 75px full-width, per-session cache, live branch).

## Out of scope
- Any new behaviour — docs + verification only.

## Acceptance criteria
- [ ] The three package AGENTS.md files and the workspace-ui scope reflect exactly what was built;
  no aspirational or contradicted statements remain.
- [ ] Full suite green: `npm run typecheck` and `npm test` pass.
- [ ] Manual smoke recorded (below) passes.

## Test / verification plan
- `npm run typecheck` (all packages) and `npm test` (full Vitest) — green.
- Manual smoke with `npm start` (real Pi provider, disk persistence — mock lacks real
  context/token/cost values):
  1. Open a session in a git repo → status bar shows model, `~`-collapsed cwd, `branch ↑↓ ● ⚠`,
     and after a turn context %, token total, and cost.
  2. Make a `git` change (edit/stage a file) → branch/dirty segment updates live.
  3. Open a second session in a different cwd, switch between them → the bar fully swaps; cached
     stats show instantly then refresh.
  4. Reconnect (reload) → restored sessions show their model (validates task-001).
  5. Run `/model` set and cycle → model segment updates (set: instant via `agent_update`; cycle:
     within one poll interval).

## Notes
- If mock-only verification is used for CI, note that context/token/cost render `--`/synthetic;
  the meaningful values require the Pi provider.
