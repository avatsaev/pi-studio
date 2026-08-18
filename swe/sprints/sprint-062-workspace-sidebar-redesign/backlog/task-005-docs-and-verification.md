# Task 005 — Docs sync + § 03 pre-ship verification

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Status:** backlog
- **Type:** docs + test
- **Area:** packages/web-client — docs, theme guards, verification
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004

## Goal

Make the written docs describe the shipped sidebar (including what is deliberately unimplemented),
then run § 07's VERIFY-BEFORE-SHIPPING list and the full project gates, recording observations
rather than assumptions.

## Context / why

Sprints 059–061 each ended with this task, for the same reason: the shipped UI and the written
scope diverge silently otherwise, and § 07's pre-ship list is the only place the redesign's
cross-cutting risks (theme variants, compact width, long strings) are checked. Two items here are
specifically about *not* pretending: § 03's `needs input` dot has no data source in this client
(task-001), and its footer `⚙` has no destination (task-004) — both must be recorded as
unimplemented in the scope doc rather than deleted from it or quietly faked.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (whole section), § 02 (token
  mapping), § 07 (SUGGESTED SEQUENCE item 1, VERIFY BEFORE SHIPPING, DO NOT)
- `swe/features/app-navigation-screens.md` § Global navigation shell (§ Sidebar content, § Sidebar
  groups references to Settings)
- `swe/features/file-explorer-quick-wins.md:29-33` — `collapsedWorkspaces` description
- `packages/web-client/AGENTS.md:265-275` (source-layout `sessions/` block), `:560-562` (empty-state
  copy), Invariants section
- `packages/web-client/src/components/primitives/IconButton.tsx:7-9` — doc comment citing
  `surfaceWorkspace` and the "absolutely positioned" session-row `⋮`
- `packages/web-client/src/theme/token-integrity.test.ts`,
  `packages/web-client/src/theme/font-scale.test.ts`
- `swe/sprints/PLAN.md` — sprint-062 block

## What to build

1. **`swe/features/app-navigation-screens.md` § Sidebar content** — resync the sidebar description
   to what this client actually renders: one scrolling workspace tree (band header + frameless
   session rows), status-only meta, a per-workspace `＋ New session` row, and a pinned
   `＋ Add workspace` footer. Mark explicitly unimplemented (do **not** delete): the footer's
   Home/Settings/host-switcher icons (no settings surface exists in the web client), the grouping
   selector, per-workspace shortcut indices, skeletons, and § 03's `needs input` state (no
   permission plumbing; the stored status enum has no `waiting`).
2. **`packages/web-client/AGENTS.md`** — update the `sessions/` source-layout block for
   `session-presentation.ts` (+ its test) and the rewritten components, then add invariants:
   - the sidebar's row states come from `session-presentation.ts` only — one presentation module,
     `status-map.ts` remains the single protocol→dot translation point;
   - no timestamps, cost, cwd, agent id or message count in the sidebar meta line (§ 03);
   - the workspace band is `surface2` with top+bottom `border`, edge-to-edge, and hovers only when
     collapsed;
   - selection is fill + inset ring + `accentForeground` + left bar; activity is the `StatusDot`
     ring — never the fill;
   - `needs input` is unsourced in this client and must not be faked;
   - the reserved-`⋮` pattern (opacity-gated, compact-visible) mirrors `TabStrip`'s `.tabClose`;
   - exactly one open-workspace affordance (the pinned footer row).
3. **Stale-comment sweep** — `IconButton.tsx`'s doc comment lists `surfaceWorkspace` as an ambient
   background and describes the session-row `⋮` as "absolutely positioned"; both are false after
   tasks 002–003. Fix the comment (not the API). Confirm by usage search that
   `surfaceWorkspace` has no remaining consumer and state that in the summary — the theme key stays
   emitted (theme contract; `token-integrity` only checks reference → emitted).
4. **`swe/features/file-explorer-quick-wins.md:29-33`** — verify its `collapsedWorkspaces`
   description is still accurate after the rewrite; correct it if the band's collapse contract
   changed shape (it should not have).
5. **§ 07 pre-ship verification**, each recorded as an observation in the task summary:
   - `token-integrity.test.ts` + `font-scale.test.ts` pass — zero dangling/illegal tokens;
   - all six theme variants, with `light` (mixes must darken, not lighten) and `zinc` (near-white
     accent → the selected row's title must be legible via `accentForeground`) checked deliberately;
   - compact form factor < 576px: band header, count pill, meta line and both `⋮` affordances still
     fit and are visible without hover;
   - long strings: a 60-char workspace name and a long failure reason — ellipsis, no wrap, no layout
     shift;
   - a live turn: idle → running → completed on a **non-selected** row (fill unchanged, ring
     appears), plus a failed turn showing the tinted row and its short reason;
   - `prefers-reduced-motion: reduce`: chevron rotation transition suppressed, ring/spinner behavior
     matching whatever sprint-060 established for the progress bar.
6. **Full gates from a clean state** (`npm run clean` first — incremental `tsc` hides errors after
   signature changes): `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run fmt:check`.
7. **PLAN.md** — mark sprint-062's coverage line as shipped in the § 03 sentence of the coverage
   check (the redesign is tracked per-sprint, not as a coverage row).

## Out of scope

- Any further visual change (tasks 002–004 own the pixels).
- Implementing a settings surface, permission plumbing, sidebar skeletons or a grouping selector —
  each is its own future scope; here they are only *documented* as unimplemented.

## Acceptance criteria

- [ ] `app-navigation-screens.md` § Sidebar content describes the shipped sidebar, with the
      unimplemented pieces named as unimplemented rather than deleted or described as working.
- [ ] `packages/web-client/AGENTS.md` lists `session-presentation.ts` in the `sessions/` layout
      block and carries the seven invariants above.
- [ ] `IconButton.tsx`'s doc comment no longer claims `surfaceWorkspace` ambience or an absolutely
      positioned session-row `⋮`; a usage search confirms `surfaceWorkspace` has no consumer.
- [ ] Every § 07 pre-ship item is recorded in the task summary as an observed result (variant names,
      widths, strings used), not as "verified".
- [ ] `npm run clean && npm run build && npm run typecheck && npm run lint && npm test &&
      npm run fmt:check` all succeed.
- [ ] PLAN.md's coverage note reflects § 03 as shipped by sprint-062.

## Test / verification plan

- Gates: the exact commands in "What to build" item 6, from clean.
- Theme guards: `npx vitest run packages/web-client/src/theme/token-integrity.test.ts
  packages/web-client/src/theme/font-scale.test.ts`.
- Manual: the § 07 sweep in item 5, in a real browser against a real daemon with at least two
  workspaces, one of them collapsed and holding a failed session.
- Docs: re-read each edited doc section against the shipped code; no aspirational statements.

## Notes

- Record deviations from § 03's mock in the summary, with reasons: single-initial `Avatar` vs the
  mock's two-letter/brand mark, `accentBright` ring on the selected row's accent fill, the omitted
  `⚙`, the single (footer-only) open-workspace affordance, and the 36px header band.
- § 03's "the icon rail is removed" has no counterpart in this client; say so once rather than
  leaving a reader hunting for a rail that never existed.
