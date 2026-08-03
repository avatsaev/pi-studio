# Task 010 summary — The status bar follows the focused pane

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Completed:** 2026-08-03 — user-verified live ("works")

## The bug

With several chats open in panes, focusing a chat did not update the model in the footer.

`StatusBar` renders exactly one subject, `session-store.activeSessionId`, and swaps every segment on it
— model, cwd, branch, context, tokens, cost. That id is written by `tab-store`'s `syncActiveSession`,
which only ran from `tab-store`'s own lifecycle methods. Focusing a pane never reaches them:
`TabStrip` and `TabPanelHost` call `layout-store.focusPane` directly from `onPointerDown`.

So after clicking into another pane, `tab-store.activeTabId` and `session-store.activeSessionId` both
still named the *previously* focused pane's chat. The footer was the visible symptom; `Ctrl/Cmd+W` and
the sidebar highlight were aimed at the wrong tab for the same reason. Precisely the drift the
single-writer design exists to prevent — the writer simply was not reached when the mutation originated
one store down.

## Fix

A module-scope `layout-store` subscription at the bottom of `tab-store.ts` re-projects `activeTabId`
(and through `syncActiveSession`, the sidebar's session) whenever the focused pane's active tab changes.

Chosen over a `tab-store.focusPane` wrapper on purpose: a wrapper fixes today's two callers and leaves
the identical trap for the next focus path — drag commit, keyboard pane navigation, a close fallback.
The subscription covers every present and future one. It reads a single derived id and bails unless that
id changed, so a divider drag's per-frame layout writes cost one read each and never re-render the tree.

## Files changed

| File | Change |
|---|---|
| `stores/tab-store.ts` | module-scope layout subscription re-projecting the active tab |
| `stores/tab-store.test.ts` | +3 tests (32 in file) |
| `packages/web-client/AGENTS.md` | derived-`activeTabId` invariant now documents the subscription and why it is not optional bookkeeping |
| `clean-room-scope/PLAN.md` | task-010 row, sprint task count 9 → 10 |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run .../tab-store.test.ts` | **32 passed** |
| `npx vitest run packages/web-client` | **45 files, 560 passed** |
| `npx tsc -b packages/web-client --force` | ✅ clean |
| `npm run build:web-client` | ✅ built in 7.69s |
| `npx oxfmt --check` / `npx oxlint` | ✅ clean, no new warnings |

## What the tests pin

- Focusing another pane updates `activeTabId` **and** `session-store.activeSessionId` to that pane's
  chat — this failed before the fix (both stayed on the other pane's chat).
- Focusing a pane whose active tab is a file updates `activeTabId` but keeps the last chat as the
  sidebar's session, preserving the existing non-chat convention.
- A divider resize leaves `tab-store`'s state object **identical** (`toBe(before)`) — no churn on drag
  frames.

## Live verification

User-confirmed: clicking between panes swaps the footer's model and per-session stats.
