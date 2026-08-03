# Task 011 — Stop legacy unconditional restore fallbacks from clobbering claim-driven restore

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live (one leg unreachable from the UI, see Acceptance)
- **Type:** bugfix
- **Depends on:** task-006, task-008
- **Size:** M

## Why

Reported live, after the sprint had already closed: restoring a split workspace was intermittently
wrong — a correctly-restored pane's chat would end up replaced by an unrelated terminal, or an unwanted
extra tab would appear, as if "old logic that reopens last-used terminals and chats automatically" was
still firing and fighting the new claim-driven restore.

It was. Two restore hooks predate the pane-split system and never learned about claims:

1. `use-session-restore.ts`'s `restoreAgents()` always force-opened a tab for `order[0]` — the
   **globally** most-recently-active agent across every workspace, not necessarily anything the user
   had open — whenever that agent wasn't itself the target of some claim.
2. `use-terminal-restore.ts`'s `runTerminalRestore()` reopened **every terminal running on the
   daemon**, in every workspace, unconditionally.

Both place their tab through `layout-store.ts`'s `claimPaneFor`, which — for an arrival with no claim —
unconditionally made it the target pane's active tab **and** stole focus, with no check for whether
that pane already held something a claim had placed there. Since the two hooks fire independently, in
undefined relative order, the sequence on a real reload was:

1. A claim correctly restores chat-X into pane A (the focused pane).
2. `use-terminal-restore` reopens some unrelated leftover terminal that happens to share pane A's
   workspace — no claim for it, so it lands in pane A (default: focused pane) and **silently replaces
   chat-X** as pane A's active tab.

That is the "legacy logic interfering with restore" the user reported — a real, demonstrable
last-writer-wins race between correct restore and unconditional legacy fallbacks, one tick later.

## Change

Three coordinated fixes, one per failure point:

1. **`layout-store.ts`'s `claimPaneFor`** — a new `restoring` flag (`true` from
   `installPersistedLayouts` until `markHydrationSource` settles both sources) gates whether an
   unclaimed arrival may activate/focus its target pane. While restoring, it may only take over a
   genuinely *empty* pane (`activeByPane[pane] === undefined`) — it still gets placed, so nothing
   leaks silently, just not activated over a claim. After the settle point the restriction lifts
   entirely: a live "+"/Ctrl+T open into the focused pane still takes it over immediately.
   - Deliberately a real state field, not `!every(hydrationSources)`: that expression is also true
     *before* any restore cycle has ever started (every unit test that never calls
     `installPersistedLayouts`), which would have wrongly restricted ordinary live opens.
2. **`use-session-restore.ts`** — the "open the most recent chat" fallback now only fires when
   `first`'s **own** workspace has no persisted layout entry at all. A persisted record for some other
   workspace must not suppress it (that workspace restores independently), and `first`'s own workspace
   having a record — even if `first` itself wasn't the specific chat claimed there — means the
   fallback would be redundant at best and disruptive at worst.
3. **`use-terminal-restore.ts`** — same principle, checked per terminal: only reopen a terminal
   automatically when its own workspace has no persisted record, or the terminal is actually claimed
   there. `layouts` is snapshotted once before the loop so an earlier terminal's own `ensureWorkspace`
   call (for a brand-new, never-split workspace) cannot make a later terminal in the *same* workspace
   look falsely "recorded" and get wrongly suppressed.

## Acceptance

- [x] An unclaimed restore-time arrival (orphaned terminal, unclaimed chat) never steals an
      already-occupied pane's active slot from a claim placed there earlier in the same restore pass —
      pinned by a new layout-store test that reproduces the exact race.
- [x] The same restriction lifts once hydration settles — a live open after restore behaves exactly as
      before this fix — pinned by a companion test.
- [x] A persisted record for one workspace does not suppress the legacy chat/terminal fallback in a
      *different*, unrecorded workspace — pinned by new hook-level tests (chat: pre-existing test
      already covered this; terminal: two new tests added).
- [x] A workspace with **no** persisted record at all still gets every running terminal reopened
      (original "never leak a terminal silently" guarantee, unchanged for the common no-split case).
- [x] **Live:** a workspace split across two conversations survived two consecutive reloads with both
      panes intact and each pane's own claimed chat active — including the "collapses on the *second*
      load" failure mode. A terminal opened into one of those panes was claimed and persisted
      correctly (`terminal:9` in `placement`/`activeByPane`), and the two other calculator agents on
      the daemon were **not** force-opened, which is the claim-only rule from change 2 holding.
- [ ] **Not reachable through the UI:** an orphaned terminal — alive on the daemon with no claim — is
      the one input the guard is really about, and closing a terminal tab kills its PTY, so the state
      cannot be manufactured from the client. It needs a terminal created outside this UI (CLI/MCP or
      another connected client), or a daemon restart that loses the tab link. Covered by the three
      unit tests that drive `claimPaneFor`/`runTerminalRestore` directly; deliberately left unproven
      live rather than claimed.

## Verification

- 7 new tests: 2 in `layout-store.test.ts` (46 in file), 3 in `restore-hydration.test.ts` (16 in file),
  plus the fix required no changes to any already-passing test once the `restoring` flag correction
  landed (the first cut of the fix, gating on raw `hydrationSources`, broke 5 unrelated tests by
  restricting ordinary live opens in tests that never drive a restore cycle — caught immediately by
  the full suite, not shipped).
- Full suite: 565 passing (45 files). `tsc -b --force` clean. `npm run build:web-client` ✓.
  `oxfmt --check` / `oxlint` clean on every touched file.
