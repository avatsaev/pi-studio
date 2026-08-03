# Task 002 summary — `TabPanelHost`: flat host positioned by pane rectangles

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Completed:** 2026-08-03

## What was built

Panels now paint at their pane's rectangle while staying flat siblings of one container. All render
decisions moved into a pure module; `TabPanelHost.tsx` is thin wiring.

- **`features/workspace/pane-layout-view.ts` (new)** — `panelBoxes(tabs, activeWorkspaceCwd, layout)`
  returns one `{ tabId, style, visible }` per tab, in `tabs` order, plus `occupiedPaneRects`,
  `paneStyle`, `percent`. This *is* the continuity invariant in code: the entry set and order derive
  from `tabs` alone, so a layout mutation can only change `style`/`visible` — never which DOM nodes
  exist.
- **Rects stay fractional and are emitted as percentages.** `paneRects` already returns 0..1 rects,
  so the browser resolves them against the host box itself.
- **Per-pane visibility** — `panelBoxes` computes `visible` as "workspace in view ∧ pane-active".
  `TerminalPanel` and `MoleculeViewerPanel` switched their own `activeTabId ===` reads to
  `useIsTabVisible(tab.id)`; `TerminalPanel`'s refit effect now keys on visibility, and its existing
  `ResizeObserver` (which observes its own panel box) already covers divider drags.
- **`.panel` CSS**: `inset: 0` → explicit `left/top/width/height: 0/0/100%/100%`, so the inline rect
  overrides cleanly instead of relying on CSS over-constraint resolution. A tab with no pane in the
  workspace in view gets no inline style and keeps the full box — deliberately not a 0×0 box, which
  `Timeline.tsx`'s virtualizer measurement guard depends on.

## Deviations from the task text (both justified)

1. **No `ResizeObserver`, no measured rects in state.** The task specified measuring the content box
   and multiplying. Since `paneRects` is fractional, percentages express the identical geometry with
   the browser doing the arithmetic: no observer, no state, no re-render per resize frame, and no
   first-paint flicker before the first measurement. Size-sensitive panels still refit, because xterm
   observes its own box, which the percentage layout changes. Pixel extents *are* needed to convert a
   divider drag delta into a fraction — that measurement belongs to the divider overlay (task-003)
   and is one `getBoundingClientRect` at drag start.
2. **The two empty states became overlays instead of early returns.** They were `return`s *before*
   the `tabs.map`, so any moment with no tabs in the workspace in view unmounted **every** panel in
   every workspace — including another workspace's live terminal, whose PTY dies on unmount. That
   directly contradicts both this file's own doc comment and the continuity invariant, so the task's
   "empty states unchanged" had to yield: they now render as absolutely-positioned siblings above an
   always-rendered panel list. Visually identical (every panel is hidden in that state anyway).

## Files changed

| File | Change |
|---|---|
| `features/workspace/pane-layout-view.ts` | **new** — pure `panelBoxes`/`occupiedPaneRects`/`paneStyle`/`percent` |
| `features/workspace/pane-layout-view.test.ts` | **new** — 14 tests |
| `features/workspace/TabPanelHost.tsx` | rects per panel, per-pane visibility, empty states as overlays |
| `features/workspace/TabPanelHost.module.css` | `.panel` explicit full box instead of `inset: 0` |
| `features/terminal/TerminalPanel.tsx` | `useIsTabVisible`; refit effect keyed on visibility |
| `features/files/MoleculeViewerPanel.tsx` | `useIsTabVisible` |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run .../pane-layout-view.test.ts` | **14 passed** |
| `npx vitest run packages/web-client` | **42 files, 497 passed** |
| `npm run build:web-client` | ✅ built in 7.42s |
| `npm run typecheck` | ✅ clean |
| `npx oxlint` (workspace/terminal/files) | ✅ no warnings |
| `npx oxfmt <6 files>` | ✅ formatted |

## Live verification (headless Chromium, `dev:daemon` + Vite dev server)

Workspace `/tmp/pane-smoke`, one chat tab + one terminal tab, layout driven through
`useLayoutStore.getState()` from the page — panel boxes read straight off `getBoundingClientRect`:

| Step | Observed |
|---|---|
| single pane | chat panel `x=220 w=900` (full host); hidden terminal panel 0×0 |
| `splitWithTab(…, "right")` | **both** visible: `x=220 w=450` and `x=670 w=450` |
| `resizeDivider([], 0, 0.2)` | widths `630 / 270` (0.7 / 0.3) |
| `moveTab` back into the source pane | tree collapses to a leaf; survivor full width `900` |
| across all three mutations | `host.children.every((c, i) => c === before[i])` → **`true`** — the exact same DOM nodes, never re-parented, never remounted |
| `splitWithTab(…, "bottom")` | chat `y=84 h=391`, terminal `y=475 h=391` (screenshot captured) |

## Acceptance criteria

- [x] One pane: same DOM shape, panel fills the host, same hidden-panel treatment (verified live:
      `x=220 w=900`, hidden panel still `display:none`).
- [x] 2-pane split: both panes' active tabs visible at complementary rects; switching the active tab
      inside one pane changes only `visible` flags, never another panel's style (unit test).
- [x] Panels never re-parented: DOM node identity held across split → resize → collapse in a real
      browser; entry order/keys asserted pure-side.
- [x] A terminal in a non-focused pane stays on screen and interactive — its panel keeps its box and
      `useIsTabVisible` stays true while `activeTabId` names the other pane's tab.
- [x] Divider drag changes the visible panels' boxes (630/270 measured live), which is exactly what
      xterm's own `ResizeObserver` refits on. **Caveat:** the rows/cols resize *frame* is not
      asserted automatically — this package has no jsdom and xterm cannot run headless-free, so the
      `stty size` check is task-007 step 6. What is proven here is that the box changes.
- [x] Workspace switch hides one workspace's panels and shows the other's without unmounting either —
      now genuinely true; before this task the no-tabs early return unmounted everything.

## Notes / follow-ups

- The tab strip is still global at this task (both panes' tabs in one strip) — task-003.
- The dev daemon has no `create_terminal_request` handler (minimal handler set), so the terminal panel
  shows "no handler" in this smoke; PTY behaviour is task-007's, against `npm start`.
