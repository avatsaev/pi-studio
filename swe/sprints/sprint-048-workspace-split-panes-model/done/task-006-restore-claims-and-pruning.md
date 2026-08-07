# Task 006 — Order-independent restore: pending claims, settle point, pruning

- **Sprint:** sprint-048-workspace-split-panes-model
- **Status:** done
- **Type:** feature
- **Area:** web-client / stores
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-004, task-005

## Goal
Rebuild each workspace's arrangement from the persisted record no matter what order restored tabs
arrive in — without ever stealing focus from the user or pruning a pane whose tab simply hasn't
arrived yet.

## Context / why
Tabs are not persisted; they are rebuilt from daemon state on connect by two independent one-shot
hooks — `use-session-restore.ts` (conversations) and `use-terminal-restore.ts` (terminals) — in no
guaranteed order. The spec's design: install geometry immediately, hold `placement`/`activeByPane`
as **pending claims**, and consume each claim as its tab arrives. No "apply layout when restore
finishes" step exists or is needed for placement.

A settle point exists only for cleanup. **Initial hydration complete** = both restore hooks have
run for this connection. Before it, an unclaimed pane is rendered as absent (`effectiveTree`) but
NEVER pruned — closing some other tab early must not destroy the pane of a terminal whose daemon
listing hasn't arrived. At it, unconsumed claims are discarded and unclaimed panes are removed from
the stored tree. (File/diff/molecule tabs have no daemon inventory and are not reopened by anything
today, so their claims die at the settle point and their panes collapse — expected behaviour.)

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Restoring a persisted layout,
  § Error Handling & Edge Cases (pending-claim rows), § Dependencies (restore-hooks bullet)
- `packages/web-client/src/hooks/use-session-restore.ts` — one-shot pattern (`restoredRef`)
- `packages/web-client/src/hooks/use-terminal-restore.ts` — same pattern (32–70)
- Modify: `packages/web-client/src/stores/layout-store.ts`
- Modify: `packages/web-client/src/lib/pane-layout-persistence.ts` (wire load → claims)
- Modify: both restore hooks (completion signal only)
- Modify: `packages/web-client/src/stores/layout-store.test.ts`

## What to build
Extend `layout-store.ts`:

```ts
installPersistedLayouts(loaded: Map<string, ValidatedWorkspaceLayout>): void;
/** Resolve a pane for an arriving tab and consume any matching claim. */
claimPaneFor(cwd: string, tabId: string, identity: string | null): void;
/** Call once per restore source per connection; after ALL sources: discard unconsumed
 *  claims, prune unclaimed panes, persist. */
markHydrationSource(source: "sessions" | "terminals"): void;
```

- `installPersistedLayouts` — set each workspace's tree/sizes up front; focus `activePaneId` when
  it names a leaf in the tree, else the first leaf; keep `placement`/`activeByPane` (identity-keyed)
  as pending claims, separate from live tab-id-keyed state.
- `claimPaneFor` resolution order (spec § Restoring): explicitly requested pane that exists →
  pending placement for this identity if its pane still exists (consume the claim) → focused pane →
  first leaf. Activation rule: the tab becomes the pane's active tab UNLESS it arrived via a claim
  and either `activeByPane` names a **different** identity for that pane, or the pane's active tab
  was already set by a **direct user action** this session (never steal focus). Track the
  user-action bit per pane, set by `focusPane`/`setActiveTab`/`assignTab(!background)` outside
  claim consumption.
- `markHydrationSource` — after both sources have reported: drop all unconsumed claims, remove every
  unclaimed empty pane via `removePane`, schedule a persistence write. Sources reset per connection
  (new connection → new hydration cycle), matching the hooks' `restoredRef` lifetime.
- Pruning guard everywhere: a pane with an outstanding pending claim is never collapsed by
  close/move-driven `removePane` sweeps before the settle point.

## Out of scope
- Wiring `claimPaneFor` into `tab-store.open` (sprint-049 task-001 — until then callers are tests).
- Rendering, drag-drop, dividers (sprint-049).

## Acceptance criteria
- [ ] Persisted 2-pane layout, tabs arriving in order A→B and B→A produce identical final state
      (tree, placement, actives, focus).
- [ ] A claimed tab arriving in a pane whose `activeByPane` names a different identity does NOT
      become active; the named one does when it arrives, regardless of arrival order.
- [ ] `activePaneId` is focused at install when present in the tree; otherwise the first leaf is.
- [ ] A pane whose `activeByPane` identity was set active by direct user action mid-restore is NOT
      displaced by a later-arriving claimed tab (the arrival joins the pane inactive).
- [ ] Before the settle point, closing an unrelated tab does not prune a pane holding an outstanding
      claim.
- [ ] After both `markHydrationSource` calls, unconsumed claims are gone and unclaimed panes are
      removed from the stored tree (verify via the persisted snapshot).
- [ ] A claim naming a pane absent from the tree falls back to focused pane, else first leaf.
- [ ] With zero persisted state, all of the above degrade to the single-pane default without errors.
- [ ] The restore hooks each signal completion exactly once per connection, including the
      zero-results and request-failure paths.

## Test / verification plan
- Tests: extend `layout-store.test.ts` with a restore describe block simulating arrival orders and
  user interleavings — one case per acceptance criterion. Hook wiring: assert
  `markHydrationSource` is called on the empty/failure paths by driving the hooks' async bodies (see
  existing hook tests for the pattern; if none fits, extract the completion call into a testable
  helper). Run `npx vitest run packages/web-client/src/stores/layout-store.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Full sprint gate: `npm test` (all web-client suites green — this is the last task of the sprint).

## Notes
- The hooks' edits are two lines each (`markHydrationSource(...)` in a `finally`); keep them inert —
  no behavioural change to what tabs they open.
- The user-action bit is session-local state, never persisted.
