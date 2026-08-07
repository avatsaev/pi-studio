# Task 001 summary — Route `tab-store` open/close/activate through the layout store

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Completed:** 2026-08-03

## What was built

`tab-store` no longer owns the active tab. Every lifecycle mutation now drives `layout-store` and
then re-projects `activeTabId` from it:

| action | layout call | derivation |
|---|---|---|
| `open` (new) | `ensureWorkspace` + `claimPaneFor(cwd, id, tabIdentity(tab))` | `activeTabOf(tab.workspaceCwd)` |
| `open` (existing id) | delegates to `activate` | — |
| `close` | `removeTab(cwd, id, order)` | `activeTabOf(activeWorkspaceCwd)` |
| `activate` | `focusPane` + `setActiveTab` (or `claimPaneFor` if unplaced) | `activeTabOf(tab.workspaceCwd)` |
| `switchWorkspace` | `ensureWorkspace` | `activeTabOf(cwd)` |

- **`syncActiveFromLayout(cwd)`** is the single writer of `activeTabId` (and of
  `activeWorkspaceCwd`). Verified by grep: the only other occurrences of `activeTabId:` in the
  package are the store's initial state and three test fixtures.
- **`lastActiveTabByWorkspace` removed**, not just ignored — the "keep the field" option would have
  left a dead map that a future reader would trust. It had no consumers outside `tab-store` itself;
  `layout-store`'s `focusedPaneId` + `activeByPane` carry the same information and are persisted, so
  a workspace switch now restores the pane *and* the tab, where before it restored only the tab.
- **`close` passes the pre-removal strip order** to `removeTab`, so the nearest-sibling fallback is
  computed against the order the user sees, matching the pre-change index rule.
- **Sidebar sync semantics preserved exactly**: `open`/`activate`/`switchWorkspace` sync
  unconditionally (a re-open of an already-active chat still re-highlights its sidebar row), while
  `close` syncs only when the derived active tab actually changed (closing a background tab must not
  move the sidebar).
- **`useIsTabVisible(tabId)`** added for task-002: the tab's workspace is in view *and* it is its own
  pane's active tab. Both of its store selectors return primitives, so a panel does not re-render
  when an unrelated tab's label changes. Its pure core is `layout-store.isPaneActiveTab(layout,
  tabId)`, which is where the per-pane rule is tested (this project's vitest runs without a DOM).

## Additions beyond the task text

1. **`tabIdentity` moved from `lib/pane-layout-persistence.ts` to `stores/tab-store.ts`.** Required:
   `tab-store.open` must compute an identity, and the persistence module imports `tab-store` at
   runtime — importing it back would have created a real ESM cycle between two Zustand stores. It is
   a property of a tab; persistence is a consumer. Import updated in the persistence module and its
   test; no behaviour change.
2. **`hooks/use-pane-layout.ts` (new) + wired into `app.tsx`'s `Boot`.** Sprint-048 built
   `installPersistedLayouts` / `installPaneLayoutPersistence` / `flushPaneLayoutWrite` but no task
   owned their call site, so nothing persisted or restored. `usePaneLayoutBoot` installs the loaded
   record, wires the write triggers *after* the install (so the install does not schedule a write of
   what it just read), and flushes on `pagehide`. It runs before the restore hooks in `Boot`, which
   is what makes "claims exist before the first tab arrives" hold — the restore hooks only fire once
   the connection reports `open`, a later commit than this mount effect. Without this, every later
   task's reload criterion is untestable.

## Files changed

| File | Change |
|---|---|
| `packages/web-client/src/stores/tab-store.ts` | lifecycle routed through layout store; `activeTabId` derived; `lastActiveTabByWorkspace` removed; `tabIdentity` moved in; `useIsTabVisible` added |
| `packages/web-client/src/stores/layout-store.ts` | `isPaneActiveTab` pure selector added |
| `packages/web-client/src/lib/pane-layout-persistence.ts` | imports `tabIdentity` from `tab-store` |
| `packages/web-client/src/hooks/use-pane-layout.ts` | **new** — boot install + write triggers + `pagehide` flush |
| `packages/web-client/src/app.tsx` | `usePaneLayoutBoot()` before the restore hooks |
| `packages/web-client/src/stores/tab-store.test.ts` | +11 tests; fixture resets `layout-store` and drops the retired field |
| `packages/web-client/src/lib/pane-layout-persistence.test.ts` | `tabIdentity` import + fixture |
| `packages/web-client/src/hooks/restore-hydration.test.ts` | fixture |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run packages/web-client/src/stores/tab-store.test.ts` | **23 passed** (12 pre-existing unchanged, 11 new) |
| `npx vitest run packages/web-client` | **41 files, 483 passed** |
| `npm run build:web-client` | ✅ built in 7.51s |
| `npm run typecheck` | ✅ `tsc -b` clean |
| `npx oxlint packages/web-client/src/stores packages/web-client/src/hooks` | ✅ no new warnings (3 pre-existing elsewhere) |
| `npx oxfmt <8 changed files>` | ✅ formatted |

## Acceptance criteria

- [x] Every existing `tab-store.test.ts` case passes — all 12 unchanged. The `beforeEach` **fixture**
      gained a `layout-store` reset and lost `lastActiveTabByWorkspace: {}`; no case body was touched.
      The reset is not optional: pane placements would otherwise leak between tests and a fallback
      could name a tab from a previous case.
- [x] Single pane: open/activate/close/switchWorkspace reproduce the POC sequences — 5 explicit
      regression cases, including the fall-to-null on the last close and the empty-workspace switch.
- [x] Two panes: closing the focused pane's last tab collapses it; `activeTabId` becomes the
      survivor's active tab.
- [x] Two panes: `activate` on an unfocused pane's tab focuses that pane; the other pane's active tab
      stays visible (`isPaneActiveTab`) while `activeTabId` names a different tab.
- [x] Re-opening an existing id focuses its pane; placement unchanged, no duplicate tab.
- [x] `switchWorkspace` restores that workspace's focused pane *and* its active tab.
- [x] `activeTabId` has exactly one runtime writer.

## Notes / follow-ups

- **Not smoke-tested in a browser yet.** Nothing renders differently at this task (single pane, same
  DOM), and the observable contract is entirely store-level, where the 23 tests exercise it. The
  live proof lands in task-003 (first visible change) and task-007 (full scenario).
- **Restore gap found, and filed as task-006** (`restore-claimed-chat-tabs`): chat identity keys on
  a local session id that is regenerated on reload, and `use-session-restore` reopens only the
  most-recent conversation, so no chat pane can survive a reload. The e2e task was renumbered to
  task-007 and `PLAN.md` updated (sprint 049 is now 7 tasks).
- `claimPaneFor` takes no `order` argument, and does not need one: an arriving tab has no source pane,
  and `order` only feeds the source-pane fallback.
