# Task 010 — The status bar (and every `activeTabId` consumer) must follow the focused pane

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done — user-verified live
- **Type:** bugfix
- **Depends on:** task-003 (pane focus)
- **Size:** S

## Why

Reported from the live smoke test: with several chats open in panes, focusing a chat does not update the
model shown in the footer.

`StatusBar` renders one subject — `session-store.activeSessionId` — and swaps every segment (model, cwd,
branch, context, tokens, cost) when it changes. That id is written by `tab-store`'s `syncActiveSession`,
which only ran from `tab-store`'s own lifecycle methods. But **focusing a pane bypasses `tab-store`
entirely**: `TabStrip` and `TabPanelHost` call `layout-store.focusPane` directly from `onPointerDown`.
So after clicking into another pane, both `tab-store.activeTabId` and `session-store.activeSessionId`
still named the previously focused pane's chat — the footer described a conversation the user was no
longer in, and `Ctrl/Cmd+W` and the sidebar highlight were pointed at it too.

This is the drift the "single writer" design was meant to prevent; the writer simply was not reached
when the mutation originated one store down.

## Change

Make the projection genuinely derived: a module-scope `layout-store` subscription at the bottom of
`tab-store.ts` re-projects `activeTabId` (and through it the sidebar session) whenever the focused
pane's active tab changes. Chosen over adding a `tab-store.focusPane` wrapper because a wrapper leaves
the same trap for the next caller — drag commit, keyboard pane navigation, a close fallback — while the
subscription covers every present and future focus path.

It reads one derived id and bails unless it changed, so a divider drag's per-frame layout writes cost
nothing.

## Acceptance

- [x] Focusing another pane updates `activeTabId` **and** `session-store.activeSessionId` to that pane's
      chat (would have failed before: both stayed on the other pane's chat).
- [x] Focusing a pane whose active tab is a file updates `activeTabId` but leaves the last chat as the
      sidebar's session — the existing non-chat convention.
- [x] A layout mutation that does not change the active tab (divider resize) leaves `tab-store`'s state
      object identical — no churn, no re-render.
- [x] **Live:** two chats in split panes on different models; clicking between panes swaps the footer's
      model, context, tokens and cost — user-verified.

## Verification

3 new tests in `tab-store.test.ts` (32 in file); full suite 560 passing; `tsc -b --force` clean.
