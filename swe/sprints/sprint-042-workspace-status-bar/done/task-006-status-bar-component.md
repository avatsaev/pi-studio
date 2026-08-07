# Task 006 — `StatusBar` powerline component + WorkspacePage mount

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-003, task-004, task-005

## Goal
Build the full-width, ~75px, y-centered powerline status bar at the bottom of the workspace shell,
rendering icon-prefixed segments — **model · cwd · git branch · context · tokens · cost** — for the
**active** session, and mount it in `WorkspacePage`.

## Background / why
This is the visible deliverable. All data is already in the stores after tasks 003–004; this task
composes it into ordered powerline segments with lucide icons and correct empty states, and pins
the bar to the bottom of the shell without disturbing the existing 3-column layout.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata, § Shell layout
- `clean-room-scope/architecture/design-system.md` § tokens (`--pi-*`)
- `packages/web-client/AGENTS.md` § WorkspacePage, § features/workspace

## What to build
- **`packages/web-client/src/features/workspace/StatusBar.tsx`** (+ `StatusBar.module.css`):
  - Read the active session from `session-store` (`activeSessionId` → entry: `model`, `cwd`), git
    meta from `git-store` (branch/ahead/behind/detached/conflictCount/available), stats from
    `stats-store` keyed by the active `sessionId`, and home dir from `use-home-dir`.
  - Render segments **in this exact order**, each with a **lucide-react icon prefix**:
    1. Model — icon `Cpu` (or `Brain`) — `model` (append thinking level if available as
       `model · high`); hidden (or provider-only) when no model.
    2. CWD — icon `Folder` — `formatCwd(cwd, home)`, CSS-ellipsized, full path in `title`.
    3. Git branch — icon `GitBranch` — `branch` + `formatBranchMeta(ahead,behind)` + dirty count
       (`● N` when >0) + `⚠ N` when `conflictCount>0`; show `(detached)` when detached; **hidden
       entirely** when `!available` (not a repo).
    4. Context — icon `Gauge` — `formatPercent(contextPercent)` with
       `(formatTokens(contextTokens)/formatTokens(contextWindow))`; `--` until first poll.
    5. Tokens — icon `Coins` — `formatTokens(totalTokens)` (in/out in `title`); `--` until poll.
    6. Cost — icon `DollarSign` — `formatCost(cost)`; `--` until poll.
  - Powerline styling: chevron separators between segments, per-segment background from `--pi-*`
    tokens, `display:flex; align-items:center` for y-centering.
- **`StatusBar.module.css`**: `.statusBar { height:75px; width:100%; display:flex;
  align-items:center; flex-shrink:0; }`, segment + chevron classes using theme vars only (no
  hard-coded colors).
- **`packages/web-client/src/routes/WorkspacePage.tsx`**: render `<StatusBar />` as the last child
  of `.shell`, after `.main`. Ensure `.shell` is a column flex and `.main` `flex:1` so the bar pins
  to the bottom and the 3-column area fills the remaining height (adjust
  `WorkspacePage.module.css` accordingly, without changing sidebar/center behaviour).

## Out of scope
- New data sources — everything is already in the stores.
- Making segments interactive (click-to-switch-model, etc.) — display only this pass.

## Acceptance criteria
- [ ] Bar spans full width, is 75px tall, contents vertically centered.
- [ ] Segments appear in order model → cwd → branch → context → tokens → cost, each with an icon.
- [ ] Switching the active session fully updates every segment (model/cwd instant; context/tokens/
  cost show cached-then-refreshed; branch reflects the active cwd).
- [ ] Branch segment live-updates on a git operation and hides when the cwd is not a git repo.
- [ ] Empty states render as specified (`--` for unpolled numbers; model hidden when absent).
- [ ] `npm run build:web` (`build:web-client`) + `npm run typecheck` pass.

## Test / verification plan
- `StatusBar.test.tsx` (mock the three stores + `use-home-dir`): asserts segment order and icons,
  the not-a-repo branch-hidden case, the detached case, `--` placeholders before stats arrive, and
  a full re-render when `activeSessionId` changes.
- `npx vitest run packages/web-client/src/features/workspace/StatusBar.test.tsx`.
- Smoke (`npm start`, session in a git repo): confirm 75px centered bar, all six segments, branch
  updates after a `git` op, context/tokens/cost after a turn, full swap on session switch.

## Notes
- Use `lucide-react` (already a dependency) — do not add an icon library. Use `--pi-*` theme vars
  exclusively for color so the bar tracks appearance/theme changes.
