# Task 003 summary — Per-pane tab strips, dividers, and pane focus

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** done
- **Completed:** 2026-08-03

## What was built

- **`TabStrip({ cwd, paneId, style, focused })`** — one strip per rendered pane, absolutely
  positioned across the top of its pane's rect. It lists the global tab order filtered by
  `placement`, highlights **its** pane's active tab (`activeByPane[paneId]`, passed to `TabItem` as a
  prop instead of each item reading `activeTabId`), focuses its pane on `pointerdown`, and its "+"
  menu focuses the pane before opening. `cwd`/`paneId` are nullable for exactly one case — no
  workspace open — where the strip renders as the same empty row with a disabled "+" as before.
- **Pane chrome geometry** (`pane-layout-view.ts`): `paneChrome(layout)` returns the strip rect per
  rendered pane plus its `focused` flag (never set with a single pane), and `paneStyle` now insets a
  panel body below the strip: `top: calc(<y>% + var(--pane-strip-height))`,
  `height: calc(<h>% - …)`. `--pane-strip-height: 33px` is declared on `.area`.
- **`PaneDividers.tsx` + module CSS (new)** — an overlay (never a layout participant, or panes and
  panels computed from the same rects would drift): a 7px hit area centred on the boundary,
  axis cursor, accent on hover/active, delta-based pointer-capture drag calling `resizeDivider` with
  `deltaPx / (splitRect extent × host extent)`.
- **`paneDividers(layout)`** returns **nothing** while any pane is unoccupied. `resizeDivider`
  addresses a split by its path in the *stored* tree, but the rendered tree is the pruned effective
  one, so a mid-restore divider could resize a split the user cannot see. `effectiveTree` returns the
  stored tree by identity when nothing is vacant, making the guard exact and free.
- **Focus**: `pointerdown` (bubbling, so an interactive child that stops propagation keeps focus put)
  on a pane's strip or its panel body → `focusPane`. The focused strip's bottom border turns accent;
  with a single pane there is no indicator, no divider, no extra chrome.
- **`WorkspacePage`** no longer renders a global strip; `.center` holds only `TabPanelHost`.

## Addition beyond the task text

**`Divider.splitRect` added to `pane-tree.ts`** (sprint-048 task-002's module) — one additive field,
plus the split's rect at the point `dividers()` already had it. Without it the px→fraction conversion
is only correct for root-level splits: `sizes` are fractions of the split, not of the host, so a
nested divider would have moved by the wrong factor (0.6 of the intended distance for a split
occupying 60% of the host). One exact-match assertion in `pane-tree.test.ts` was extended for the new
field and a test added for the nested case.

## Files changed

| File | Change |
|---|---|
| `features/workspace/TabStrip.tsx` | pane-scoped props, pane-active highlight, focus on pointerdown, "+" opens into its pane |
| `features/workspace/TabStrip.module.css` | `.paneStrip` absolute placement, `.focused` accent border |
| `features/workspace/PaneDividers.tsx` + `.module.css` | **new** — draggable boundary overlay |
| `features/workspace/pane-layout-view.ts` | `paneChrome`, `paneDividers`, strip-inset `paneStyle` |
| `features/workspace/pane-layout-view.test.ts` | +11 tests (25 total in the file) |
| `features/workspace/TabPanelHost.tsx` | renders strips + dividers, focus-on-body |
| `features/workspace/TabPanelHost.module.css` | `--pane-strip-height`, empty states inset below the strip |
| `features/workspace/pane-tree.ts` / `.test.ts` | `Divider.splitRect` (+2 test updates) |
| `routes/WorkspacePage.tsx` | global strip dropped |

## Commands run

| Command | Result |
|---|---|
| `npx vitest run packages/web-client` | **42 files, 505 passed** |
| `npm run build:web-client` | ✅ built in 7.52s |
| `npx oxlint` (workspace + routes) | ✅ no warnings |
| `npx oxfmt` (16 files) | ✅ formatted |

`theme/token-integrity.test.ts` caught the strip-height variable when it was first named
`--pi-pane-strip-height`: that prefix is reserved for theme-emitted tokens. Renamed to
`--pane-strip-height` (component-local metric), which is the invariant that test exists to defend.

## Live verification (headless Chromium, `dev:daemon` + Vite dev server, real pointer/keyboard events)

| Check | Observed |
|---|---|
| single pane, strip geometry | `x=220 y=51 w=900 h=33` — **identical** to the pre-change global strip (measured before the change: `top=51`, `height=33`); panel body `y=84 h=781`, exactly the old area box |
| two panes | two strips at `x=220 w=450` and `x=670 w=450`, each listing only its own pane's tabs |
| focus indicator | focused strip border `rgb(46,92,184)` (accent) vs `rgb(37,43,42)`; single pane → no indicator |
| divider | one handle per boundary at `x=667 w=7 h=814`, `cursor: col-resize`; sidebar handles unaffected |
| divider drag (mouse down/move/up) | 450/450 → +250px → **700/200**, i.e. exactly the pixel delta |
| clamp | dragged hard left → **90/810** = `MIN_PANE_FRACTION` 0.1 |
| focus by clicking a pane body | focus moved to that pane; `activeTabId` became its active tab (`mol-new-1` → derived-active wiring proven end to end) |
| a non-focused pane's "+" → New molecule | opened in **that** pane and focused it (`activeTabId = mol-new-3`) |
| `Ctrl+W` | closed the focused pane's active tab, fell back to that pane's next tab |
| reorder inside a strip (drag) | `mol-new-2` dragged onto `New chat` → global order changed, strip re-rendered |
| persistence write | record holds `sizes: [0.7, 0.3]` (and `[0.1, 0.9]` after the clamp test) |
| reload | before hydration settles, the layout store already holds the persisted split with `sizes: [0.7, 0.3]` and both pane claims pending |

## Acceptance criteria

- [x] Single pane visually identical to before — strip rect and panel rect measured equal to the
      pre-change values; no divider, no focus ring.
- [x] Two panes: each strip lists only its pane's tabs in global-order projection; clicking a tab
      activates it in that pane only.
- [x] Each pane's "+" opens in that pane and focuses it.
- [x] Dividers render between adjacent panes only (2 panes → 1 divider), overlay the boundary without
      shifting content (panel rects unchanged by their presence), show the axis cursor.
- [x] Dragging a divider resizes only the two adjacent panes and clamps at `MIN_PANE_FRACTION`.
- [x] Proportions survive a reload — **write and install both proven** (record `[0.7, 0.3]`; the
      persisted tree is installed with those sizes on the next load). The full round trip ends with
      that pane pruned, because the chat tab comes back under a different session id: the identity
      defect task-006 fixes. Nothing here is missing — the geometry half is complete and observed.
- [x] Clicking a pane's body focuses it, indicator follows, and `use-shortcuts.ts`'s Ctrl+W acts on
      the focused pane's active tab.
- [x] Reorder within a single strip still works exactly as today.

## Notes / follow-ups

- Each strip keeps its own `DndContext` in this task, as instructed; task-004 lifts one context above
  all panes.
- Driving the layout store from the page needed the module URL Vite actually served
  (`performance.getEntriesByType('resource')` → `/src/stores/layout-store.ts?t=…`): a bare
  `import('/src/stores/layout-store.ts')` after an HMR update resolves to a *second* module instance
  with empty state. Worth knowing for any future in-page store poking.
