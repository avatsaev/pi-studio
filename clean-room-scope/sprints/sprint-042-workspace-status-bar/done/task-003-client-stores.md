# Task 003 — Client stores: git branch retention, session model, stats slice

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** M
- **Depends on:** none (consumes the server fields from task-001/002 at runtime, but the store
  code is independent)

## Goal
Prepare the three Zustand state sources the status bar reads: (a) retain git branch/ahead/behind/
dirty/conflict info in `git-store` (currently discarded), (b) add a `model?` field to
`session-store` session entries, and (c) add a new per-session `stats-store` slice holding context
usage, token totals, cost, and the poll-reconciled model.

## Background / why
The bar's four+ segments read from existing client state where possible:
- **Branch** (+ `↑ahead ↓behind`, dirty count, conflict flag): `use-checkout-status.ts` already
  receives the full `CheckoutStatusProjection` (`branch`, `ahead`, `behind`, `detached`,
  `upstream`, `conflicted`, `hasConflicts`, staged/unstaged/untracked), but `git-store.applyProjection`
  throws all of it away except the flattened file `changes[]`. Keep the git meta alongside `changes`.
- **Model / cwd**: `session-store` already tracks `cwd` per `SessionEntry`; add `model?`.
- **Context / tokens / cost / authoritative model**: no stream event carries these — they come from
  a poll (task-004). A dedicated `stats-store` keyed by **sessionId** lets a session-switch show the
  last-known value instantly (no blank flash) while a fresh poll runs.

## Scope references
- `clean-room-scope/features/git-checkout.md` § Checkout status projection
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata
- `packages/web-client/AGENTS.md` § git-store, § session-store

## What to build
- **`packages/web-client/src/stores/git-store.ts`**:
  - Add fields to the store state: `branch: string | null`, `ahead: number`, `behind: number`,
    `detached: boolean`, `upstream: string | null`, `conflictCount: number`, `available: boolean`.
  - `applyProjection` sets them from the projection (and clears them to defaults when the projection
    is null/unavailable), in addition to the existing `changes[]` mapping. `dirtyCount` is derivable
    from `changes.length` (staged+unstaged+untracked) — expose a selector or store it.
- **`packages/web-client/src/stores/session-store.ts`**:
  - Add `model?: string` to `SessionEntry`.
  - `hydrate` accepts/persists `model`; add a `setModel(sessionId, model)` action and a
    `setModelByAgentId(agentId, model)` (mirroring the existing `setStatusByAgentId`) for
    `agent_update`-driven updates.
- **`packages/web-client/src/stores/stats-store.ts`** (new): a Zustand slice
  `Record<sessionId, { contextTokens?: number; contextWindow?: number; contextPercent?: number;
  totalTokens?: number; inputTokens?: number; outputTokens?: number; cost?: number; model?: string }>`
  with `setStats(sessionId, partial)` (merge) and `clear(sessionId)` (on session removal).

## Out of scope
- The poll that fills `stats-store` (task-004).
- Wiring `list_agents` model into `session-store` on restore (task-004).
- The component that reads all of this (task-006).

## Acceptance criteria
- [ ] `git-store` exposes branch/ahead/behind/detached/upstream/conflictCount/available and resets
  them when the projection is unavailable; `changes[]` behaviour is unchanged.
- [ ] `SessionEntry.model` exists; `setModel`/`setModelByAgentId`/`hydrate(model)` work.
- [ ] `stats-store` merges per-session partials and clears per session.
- [ ] `npm run typecheck` passes; existing `explorer-store`/`git-store` tests still green.

## Test / verification plan
- Extend `git-store` test (or add one): applying a projection with `branch:"main", ahead:2,
  behind:1, hasConflicts:true` sets the meta; applying `{available:false}` resets it while emptying
  `changes`.
- Add `session-store` assertions: `setModelByAgentId` updates the matching session's `model`;
  `hydrate` round-trips `model`.
- Add `stats-store.test.ts`: `setStats` merges partials per session; `clear` removes one session
  without touching others.
- `npx vitest run packages/web-client/src/stores`.

## Notes
- Keep the git meta **in `git-store`**, not a new store — it is the same subscription's projection,
  and the plan's convention is one active-cwd subscription. Do not add a parallel branch store.
