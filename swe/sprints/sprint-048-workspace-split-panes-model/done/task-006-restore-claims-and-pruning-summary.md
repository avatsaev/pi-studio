# Task 006 — Order-independent restore: pending claims, settle point, pruning — Summary

- **Sprint:** sprint-048-workspace-split-panes-model
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

The restore layer on `layout-store`, plus the hydration signal in both connect-time restore hooks.

**New layout state** (session-local, never persisted — the persistence snapshot names its fields
explicitly, so these cannot leak into the record):

```ts
pendingPlacement: Record<string, string>;   // identity -> pane id, unconsumed claims
pendingActive:    Record<string, string>;   // pane id -> the identity it wants active
userActedPanes:   ReadonlySet<string>;      // panes whose active tab the user chose
```

**New actions:**

- `installPersistedLayouts(loaded)` — installs each workspace's tree and sizes immediately (geometry
  is right before the first tab exists), focuses `activePaneId` when it names a leaf and the first
  leaf otherwise, and holds the record's `placement`/`activeByPane` as pending claims. Resets the
  hydration cycle.
- `claimPaneFor(cwd, tabId, identity, paneId?)` — the single entry point for every tab open. Pane
  resolution follows the spec exactly: explicit pane that exists → pending claim whose pane still
  exists (consumed) → focused pane → first leaf.
- `markHydrationSource("sessions" | "terminals")` — once **both** have reported, drops every
  unconsumed claim and prunes the panes no tab claimed.

**Three rules that took real design care:**

1. **Activation is order-independent.** A claim-driven arrival activates unless the user already
   chose that pane's active tab, or the pane wants a *different* identity **and already has an active
   tab**. That last conjunct is what makes order irrelevant: whoever arrives first into an empty pane
   shows (so a pane is never left blank), and when the identity the record actually names turns up it
   takes over. Reverse the arrival order and the same tab ends up active.
2. **A claim-driven arrival never moves focus.** The persisted `activePaneId` already decided focus;
   `placeTab` therefore takes `activate` and `focus` as separate flags. A user-initiated open still
   does both, exactly as before.
3. **The pruning guard is self-disabling.** `withPaneRemoved` refuses while any claim still names the
   pane, so closing an unrelated tab early cannot destroy the pane of a terminal whose daemon listing
   has not arrived. The settle point empties both pending maps *first*, which is what re-enables
   pruning — no boolean flag threaded through the pure helpers.

**Restore hooks.** Each hook's async body moved into an exported `runSessionRestore(client)` /
`runTerminalRestore(client)` wrapping the original logic in `try { … } finally {
markHydrationSource(…) }`. The extraction was necessary, not cosmetic: `use-terminal-restore`'s
`if (terminals.length === 0) return` and `use-session-restore`'s `if (!first) return` are early
returns on the *most common* path (a daemon with nothing to restore), and a settle point that never
fires would leave every persisted pane un-prunable forever. The hooks' one-shot `restoredRef` guard
and the tabs they open are unchanged.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/stores/layout-store.ts` | modified — restore layer (321 → 515 lines) |
| `packages/web-client/src/stores/layout-store.test.ts` | modified — 15 restore tests added (29 → 44) |
| `packages/web-client/src/hooks/use-session-restore.ts` | modified — `runSessionRestore` + `restoreAgents` extraction |
| `packages/web-client/src/hooks/use-terminal-restore.ts` | modified — `runTerminalRestore` extraction |
| `packages/web-client/src/hooks/restore-hydration.test.ts` | created — 8 tests |

## Deviations from the task file

1. **`focusPane` does not set the user-action bit.** The task's parenthetical listed it alongside
   `setActiveTab`/`assignTab`, but the spec's rule is about *the pane's active tab* being user-chosen.
   Focusing an empty pane chooses no tab, and marking it would leave that pane permanently blank for
   the rest of restore — every later claimed arrival would refuse to activate. `setActiveTab` and
   `assignTab(!background)` (and `moveTab`/`splitWithTab`, which are unambiguously user gestures) set
   it; `focusPane` does not.
2. **The settle point also repairs a blank pane.** A pane holding tabs but no active tab — possible
   when the identity it wanted never arrived — is given one at the settle point. Without this the
   record's `activeByPane` naming a since-deleted agent would leave a permanently empty-looking pane
   full of tabs. Not in the task text; it closes a hole the activation rule would otherwise open.
3. **No `resetHydration()` action.** Both hooks are one-shot per *mount* (`restoredRef` is never
   cleared), so hydration happens once per page load. `installPersistedLayouts` resets the cycle,
   which covers the only path that could legitimately start a second one. Adding an uncalled reset
   action would have been scaffolding.
4. **Hook bodies extracted rather than tested through rendering.** The task allowed either; this
   project's vitest runs `.test.ts` under plain Node with no DOM (documented in
   `use-session-restore.ts`), so rendering was not an option.

## How it satisfies the scope

- § Restoring a persisted layout — the pseudocode implemented verbatim: install geometry + focus
  immediately, hold claims, resolve per-arrival in the documented precedence order, never steal focus.
- § Error Handling & Edge Cases — "a persisted pane never claimed by any tab" (rendered absent by
  task-002's `effectiveTree`, pruned at the settle point) and "tab closed or moved while restore
  claims are outstanding" (normal behaviour, but a claimed pane is never pruned by it).
- § Dependencies — the restore-hooks bullet: both are one-shot per connection, which is what makes
  "initial hydration complete" implementable; this task is what turns that property into a signal.

## Build & test results

```
$ npx vitest run packages/web-client/src/stores/layout-store.test.ts
✓ 44 tests

$ npx vitest run packages/web-client/src/hooks/restore-hydration.test.ts
✓ 8 tests

$ npm run build
(all packages, through build:cli — success)

$ npm run typecheck            # tsc -b
(clean)

$ npm test
Test Files  127 passed (127)
     Tests  1287 passed (1287)

$ npx oxlint <all 9 sprint files>
exit:0   (no warnings)

$ npx oxfmt --check packages/web-client/src   # none of the 27 pre-existing issues are in these files
```

## Acceptance criteria

- [x] A persisted 2-pane layout with tabs arriving A→B and B→A produces identical final state — the
      test maps both orders and asserts the whole `{tree, placement, activeByPane, focusedPaneId}`
      records are `toEqual`.
- [x] A claimed tab arriving in a pane whose `activeByPane` names a different identity does not
      become active; the named one does, regardless of order — asserted over both permutations.
- [x] `activePaneId` is focused at install when present in the tree; the first leaf otherwise.
- [x] A pane whose active tab was set by direct user action mid-restore is not displaced by a
      later-arriving claimed tab — the arrival joins the pane inactive.
- [x] Before the settle point, closing an unrelated tab does not prune a pane holding an outstanding
      claim (asserted from both directions — closing the arrived tab, and closing a tab while the
      *other* pane is still unclaimed).
- [x] After both `markHydrationSource` calls, unconsumed claims are gone and unclaimed panes are
      removed from the stored tree; one source alone prunes nothing.
- [x] A claim naming a pane absent from the tree falls back to the focused pane.
- [x] With zero persisted state everything degrades to the single-pane default.
- [x] Both hooks signal completion on the zero-results and request-failure paths, and neither reports
      the other's source — 8 cases in `restore-hydration.test.ts`, including a "no `terminals` field
      at all" response and an end-to-end both-sources gate.

Plus: explicit-pane-over-claim precedence, no-focus-movement on claim arrival, per-source
idempotence, blank-pane repair, and hydration-cycle reset.

## Follow-ups / TODO(verify)

- `claimPaneFor` has no production caller yet — sprint-049 task-001 routes `tab-store.open` through
  it. Until then the hooks signal hydration into a store with no workspaces, which settles over zero
  entries: genuinely inert.
- `installPersistedLayouts(loadPaneLayout())` needs an app-bootstrap call site (sprint-049 task-001/002),
  alongside `installPaneLayoutPersistence()` and a `pagehide` flush.
