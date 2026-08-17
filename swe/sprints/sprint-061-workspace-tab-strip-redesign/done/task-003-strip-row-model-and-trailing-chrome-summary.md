# Task 003 — Strip row model: ＋ beside the last tab, split controls pinned right — Summary

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

Gave the strip § 07's three-part row model: `.tabs` changed from `flex: 1 1 auto` (which ate all free
space and shoved ＋ against the split buttons at the far right) to `flex: 0 1 auto` (shrink, never
grow), so ＋ now sits as the immediate next sibling of the tab list instead of reading as part of the
split cluster. The two split buttons are now wrapped in a new `.stripActions` element
(`margin-left: auto; display: flex; align-items: center; gap: var(--pi-spacing-8); flex: none;`,
matching § 07's reference block verbatim) that claims the strip's right edge. All three trailing
controls (＋, split-right, split-down) now pass `IconButton`'s `size="xs"` explicitly rather than
relying on the default, and their `border-radius: var(--pi-radius-sm)` moved from three duplicated
inline `style` props into the CSS module (`.newTab`, `.splitAction`). All six glyphs in this file that
were still raw `lucide` elements — the ＋ trigger, the three new-tab menu items, and the two split
icons — now route through the `Icon` primitive (`size="sm"`/14px for the three controls,
`size="xs"`/12px for the three menu items), finishing the file-wide "no raw `size={n}`" rule task-002
started on `TabItem`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/TabStrip.tsx` | `NewTabMenu`: `Icon` primitive for the trigger (`sm`) and all three menu items (`xs`); `IconButton` gets explicit `size="xs"`, inline `style` prop removed. `SplitActions`: return wrapped in a `.stripActions` div; both `IconButton`s get explicit `size="xs"` and `Icon`-primitive glyphs (`sm`), inline `style` props removed |
| `packages/web-client/src/features/workspace/TabStrip.module.css` | `.tabs`: `flex: 1 1 auto` → `flex: 0 1 auto`. `.newTab`: added `border-radius: var(--pi-radius-sm); flex: none;` (dropped its `margin: 0 var(--pi-spacing-4)` so the only spacing between the last pill and ＋ is `.strip`'s own `gap: var(--pi-spacing-2)`, matching the acceptance criterion's "one spacing-2 gap"). Added `.stripActions`. `.splitAction`: `flex-shrink: 0` → `flex: none`, added `border-radius: var(--pi-radius-sm)` |

## How it satisfies the scope

- **Row model.** `.tabs` shrinks but never grows, so ＋ is pulled left to sit beside the last pill;
  `.stripActions`' `margin-left: auto` claims all remaining space and pins the split buttons to the
  strip's right padding edge — exactly § 07's order (tabs → ＋ → auto-space → split-right →
  split-down).
- **`.tabs` stays a separate scroll container.** Untouched apart from the flex-grow change — the
  actions remain outside it, preserving sprint-049's fix for split buttons scrolling out of reach in a
  narrow pane; task-002's pill floor means overflow is still reachable once pills hit their minimum.
- **`hoverBase` was already right; `size` is now explicit.** All three controls already passed
  `hoverBase="var(--pi-color-background)"` (unchanged — that's what shows through the transparent band
  per task-001). `size="xs"` (20px) is now passed explicitly on all three rather than relying on
  `IconButton`'s default, so the strip's rhythm doesn't silently depend on a primitive's default value.
- **Icon primitive, no raw sizes.** Six glyphs converted; combined with task-002's `TabItem` icons,
  no raw `lucide` element with a literal `size={n}` remains anywhere in `TabStrip.tsx`.
- **Behavior frozen.** `NewTabMenu`'s pane-targeted opens and `workspaceCwd === null` guard,
  `SplitActions`' `splitEmpty` + `openNewChat` seeding and its two `canSplit` refusal tooltips, and the
  strip-level `useDroppable` + `onPointerDown` → `focusPane` are all byte-identical — only the
  rendering markup around them (an added wrapper div, `Icon` swaps) changed. ＋ remains a sibling of
  `SortableContext`, never wrapped into `.stripActions` (GitHub issue #8's constraint, preserved).

## Build & test results

```
$ npm run build:web-client
✓ built in 12.63s

$ npm run typecheck
(clean, no output)

$ npx oxlint packages/web-client/src/features/workspace/TabStrip.tsx packages/web-client/src/features/workspace/TabStrip.module.css
(clean, no output)

$ npx oxfmt --check packages/web-client/src/features/workspace/TabStrip.tsx packages/web-client/src/features/workspace/TabStrip.module.css
All matched files use the correct format.

$ npx vitest run packages/web-client/src/features/workspace
Test Files  7 passed (7)
     Tests  151 passed (151)

$ npx vitest run packages/web-client
Test Files  57 passed (57)
     Tests  779 passed (779)
```

## Acceptance criteria

- [x] With one tab in a wide pane, ＋ sits immediately right of that pill with one `spacing-2` gap
      (`.newTab`'s own margin removed so `.strip`'s flex `gap` is the only spacing source), and the
      two split buttons sit flush against the strip's right padding edge via `.stripActions`'
      `margin-left: auto`.
- [x] With enough tabs to overflow, ＋ and both split buttons stay outside `.tabs`' scroll container
      (`flex: none` on `.newTab` and `.stripActions`) — only the tabs scroll; unchanged from before
      this task (sprint-049's fix), now reinforced by `.tabs`' `flex: 0 1 auto`.
- [x] All three controls are 20px `IconButton`s (`size="xs"` explicit) with `radius-sm`
      (`.newTab`/`.splitAction`), hover-lifting off `hoverBase="var(--pi-color-background)"`; no
      inline `style` prop remains in `TabStrip.tsx` except the dnd `transform`/`transition`/`opacity`
      on `TabItem` (verified by reading the file — grep for `style={{` finds exactly one match).
- [x] Split-right/split-down still call `splitEmpty` + `openNewChat` and disable with "Open a
      workspace to split" / "Maximum split depth reached" — logic untouched, confirmed by
      `pane-dnd.test.ts`/`pane-tree.test.ts` (`canSplit`) passing unedited.
- [x] The ＋ menu still opens New chat/New terminal/New molecule into the clicked pane via
      `openInPane`'s explicit `paneId ?? undefined` and disables with no workspace open
      (`disabled={!workspaceCwd}`) — logic untouched.
- [x] Clicking anywhere on the strip still calls `focusPane` via the unedited `onPointerDown` handler
      on the outer `.strip` div.

## Follow-ups / TODO(verify)

- Visual confirmation (wide-pane and ~300px-pane positions/reachability, split-to-depth-4 refusal
  tooltips, per-pane menu targeting, unfocused-pane strip click) is deferred to task-005's § 07
  pre-ship verification sweep, per this sprint's established pattern.
