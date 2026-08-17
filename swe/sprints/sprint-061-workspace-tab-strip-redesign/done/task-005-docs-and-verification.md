# Task 005 — Docs sync, stale spec-path sweep, § 07 pre-ship verification

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Status:** done
- **Type:** docs + test
- **Area:** packages/web-client (docs), swe/features, swe/sprints
- **Priority:** P2
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003, task-004

## Goal

Leave the written record matching the shipped strip — `swe/features/workspace-ui.md`'s § Desktop tab
strip and `packages/web-client/AGENTS.md`'s workspace layout + invariants — repair the handoff-spec
path that moved on disk, and run § 07's VERIFY BEFORE SHIPPING list with the results recorded as
observations, not assumptions.

## Context / why

Three loose ends this sprint creates or inherits:

**(a) Both docs describe the model this sprint replaces.**
`packages/web-client/AGENTS.md:270-274` describes "that pane's tabs in a `.tabs` scroll container,
plus **non-shrinking** trailing actions pinned outside it" — after task 002/003 the tabs shrink first
and scroll only at their floor, and the actions are a `.stripActions` cluster.
`swe/features/workspace-ui.md:175-183` describes pre-redesign chips ("active tab shows the accent
indicator", "loading tabs show a skeleton bar") and a width-distribution model that was never
implemented that way. Neither file currently says anything about the pill geometry, the truncation
contract, the close-box reservation, or where the 36px number is declared — the four things a future
change is most likely to break silently.

**(b) The handoff spec's path moved and every citation is stale.** The design folder is now
`swe/UI design/redesign 0.1.0/` on disk; `swe/sprints/PLAN.md` (lines 91, 92, 1088, 1182, 1254) and
`swe/features/timeline-rendering.md` (lines 46, 171, 248) still cite `swe/design/redesign 0.1.0/…`, as
do sprint-059/060's task files. Fix the **living** docs (PLAN.md, `features/*.md`, `AGENTS.md`, this
sprint's own files). Leave `sprint-059/done/` and `sprint-060/done/` task and summary files alone:
they are the audit trail of what was written when, and rewriting closed tasks to match a later rename
is the one edit the plan's own rules forbid.

**(c) § 07 has a pre-ship list, and it is not "it looks right on my machine."** From § 07 (VERIFY
BEFORE SHIPPING): the theme guard tests; all six theme variants with `light` (mixes must darken) and
`zinc` (near-white accent) checked deliberately; compact form factor below 576px with hover-only
affordances always visible; and long strings — 60-char names, deep paths — ellipsised with no wrap and
no layout shift. Sprint-059/task-005 and sprint-060/task-003 are the house pattern for this: the
summary records what was observed per item.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (whole section, incl. VERIFY
  BEFORE SHIPPING and DO NOT), § 02 (token mapping)
- `swe/features/workspace-ui.md:151-188` — § Pane / split model, § Desktop tab strip, § Mobile tab UI
- `packages/web-client/AGENTS.md:96-100` (Menu primitive's TabStrip mention), `:269-275` (workspace
  source layout), the Invariants section, `:1156-1160` (the `closeTab` invariant — must stay true)
- `swe/sprints/PLAN.md:91,92,1088,1182,1254` and `swe/features/timeline-rendering.md:46,171,248` —
  stale `swe/design/…` citations
- `packages/web-client/src/features/workspace/TabStrip.module.css`, `TabStrip.tsx`,
  `TabPanelHost.module.css`, `pane-layout-view.ts`, `tab-attention.ts` — the shipped behavior being
  documented
- Modify: `swe/features/workspace-ui.md`, `packages/web-client/AGENTS.md`, `swe/sprints/PLAN.md`,
  `swe/features/timeline-rendering.md`

## What to build

**1. `swe/features/workspace-ui.md` § Desktop tab strip, rewritten to the shipped design.** Height 36
band with `spacing-8` side padding, a bottom border and no surface of its own; a tab is a 24px
`radius-md` pill (`spacing-10` padding, `spacing-7` gaps, `2xs` rung, mono label for path kinds) that
is `flex: 0 1 auto` with a floor and a 200px cap, truncating its label with an ellipsis before the
strip ever scrolls; per-kind lucide glyph at `icon-size-xs` with `accentBright` on the active chat tab;
`StatusDot` for a background chat tab that is running or errored; × always on the active tab, hover/
focus-gated elsewhere with a reserved box, always visible under 576px or a coarse pointer; trailing
cluster order ＋ · (auto) · split-right · split-down. Two honesty items, following sprint-060/task-003's
pattern of marking rather than deleting reference-app behavior: **skeleton bars for loading tabs** and
a **per-tab context menu + tooltip** (lines 178-180) are reference-app behavior that this client does
not implement; and the dot's **"needs input"** state has no session-level source in this app today
(the protocol status enum has no `waiting`), so only running/errored are shown. Update § Pane / split
model's tab-strip sentence if it contradicts any of the above.

**2. `packages/web-client/AGENTS.md`.** Rewrite the `workspace/` layout entry for `TabStrip` (and add
`tab-attention.ts` + its test to that folder's file list) so it describes the shrink-then-scroll model
and the `.stripActions` cluster. Then add invariants — the point is the traps, not a restatement of
the CSS:
- The strip band's height is declared **once**, as `--pane-strip-height` in
  `TabPanelHost.module.css`; `pane-layout-view.ts`'s `calc()`s, the strip's own `min-height`, and the
  empty-state offsets all read it, and `pane-layout-view.test.ts` asserts those strings symbolically.
  It is a `--pane-*` name on purpose: `--pi-*` is theme-emitted and `token-integrity.test.ts` fails
  any `var(--pi-…)` the theme does not define. It matches
  `platform/breakpoints.ts`'s `WORKSPACE_SECONDARY_HEADER_HEIGHT`.
- Tabs shrink, chrome does not: `.tab` is `flex: 0 1 auto; min-width: <floor>; max-width: 200px` and
  only `.tabLabel` ellipsises; `.tabs` is `flex: 0 1 auto` (never `1 1`, which pushes ＋ to the right
  edge) and scrolls only once pills hit their floor; ＋ and `.stripActions` are `flex: none` outside
  the scroll container so they stay reachable in a narrow pane (sprint-049's fix, preserved).
- The × box is reserved and toggled with `opacity`, never `display`, so hovering never re-truncates a
  label; the compact/coarse-pointer always-visible branch is the CSS mirror of `helpers.ts`'s
  `hoverVisible`, because nothing in this package feeds a live width into it.
- ＋ stays outside `SortableContext` (issue #8); icons in this file go through the `Icon` primitive at
  token sizes, never raw lucide `size={n}`.
- A tab's attention dot is a projection of session status via `tab-attention.ts`; there is no per-tab
  unread state, and the active tab deliberately shows none because `TurnProgressBar` covers it.

**3. Stale-path sweep.** Rewrite `swe/design/redesign 0.1.0/` → `swe/UI design/redesign 0.1.0/` in
`swe/sprints/PLAN.md` and `swe/features/timeline-rendering.md` only, and add one line to PLAN.md's
Coverage-check redesign paragraph noting the rename so the untouched `done/` citations are explained
rather than looking like a mistake.

**4. PLAN.md sprint bookkeeping.** Mark sprint-061's row/section state as this sprint's work lands
(the row, task index and coverage entries are added at planning time; this task keeps them true —
including the remaining-work sentence at `:1257-1259`, which must drop pane headers/tab strip from the
unplanned list).

**5. § 07 verification sweep**, recorded in this task's summary as observed results:
- `npx vitest run packages/web-client/src/theme` (token-integrity + font-scale), then the full
  `npm test`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`.
- All six theme variants, with `light` and `zinc` called out individually: the pill hover mix must
  darken on `light`, and the active pill must stay legible on `zinc`.
- Compact: below 576px and with a coarse pointer, every closable tab shows its ×.
- Long strings: a 60-character file name, a deep path, and eight tabs in a ~300px pane — ellipsis, no
  wrap, no layout shift, ＋/split always reachable.
- Split panes: 2×2 layout, each strip highlights its own pane's active tab; drag reorder, cross-pane
  move, and edge-split still work and the drop preview aligns with the 36px band; each pane body
  scrolls independently (§ 07's own check).
- A live turn: the progress bar sits flush under the strip's border across the full pane width, and a
  background chat tab shows the attention ring.

## Out of scope

- Any source change beyond what tasks 001-004 shipped (a docs task that edits behavior hides it).
- Rewriting `sprint-059`/`sprint-060` `done/` task or summary files for the folder rename.
- § 03 sidebar, § 05 composer/queue chips, § 06 FileExplorer chrome docs — their own sprints.
- `swe/features/feature-panels-ui.md` (Files/Changes tabs) — § 06.
- Adding component/DOM tests: the project has no jsdom test layer by convention
  (`packages/web-client/AGENTS.md` § Testing); `tab-attention.test.ts` from task 004 is the sprint's
  unit coverage.

## Acceptance criteria

- [ ] `swe/features/workspace-ui.md` § Desktop tab strip describes the shipped strip, with the two
      unimplemented reference-app behaviors and the missing needs-input source explicitly marked as
      such rather than silently dropped.
- [ ] `packages/web-client/AGENTS.md`'s workspace layout entry matches the shipped file set (including
      `tab-attention.ts`), and its Invariants section carries the six rules above with a reason each.
- [ ] No living doc (`swe/sprints/PLAN.md`, `swe/features/*.md`, any `AGENTS.md`) still cites
      `swe/design/redesign 0.1.0/`; verified by search. `done/` task files are untouched, and PLAN.md
      explains why.
- [ ] PLAN.md's remaining-redesign-work sentence no longer lists the tab strip / pane chrome as
      unplanned, and sprint-061's coverage entry names `features/workspace-ui.md`.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check` and `npm test` all pass
      from a clean state (`npm run clean` first — incremental `.tsbuildinfo` hides signature-level
      errors).
- [ ] Every § 07 VERIFY item above is recorded in the task summary as an observation (what was done,
      what was seen), with any gap written as a `TODO(verify)` rather than assumed.

## Test / verification plan

- Docs: read each rewritten section against the shipped source files side by side; every rule stated
  must be traceable to a line of code.
- Search gates: `swe/design/redesign` → no hits outside `sprints/sprint-059*/done/` and
  `sprints/sprint-060*/done/`; `33px` → no hits in `features/workspace/`.
- Full gates from repo root, clean: `npm run clean && npm run build && npm run typecheck &&
  npm run lint && npm run fmt:check && npm test`.
- Manual: the browser sweep listed in § 5, driven against `npm start` (terminals and file uploads need
  the production bootstrap, not `dev:daemon` — `AGENTS.md:755-759`).

## Notes

- Match each doc's existing structure and voice; do not reformat sections this sprint did not change.
- `AGENTS.md:1156-1160`'s `closeTab` invariant (every close path goes through the wrapper so an empty
  chat session is discarded) must still be true after task 002's markup change — re-read it and
  confirm rather than assuming, since the × handler was touched.
- If the verification sweep turns up a genuine visual defect in the shipped strip, fix it here and say
  so in the summary; that is this task doing its job, not scope creep.
