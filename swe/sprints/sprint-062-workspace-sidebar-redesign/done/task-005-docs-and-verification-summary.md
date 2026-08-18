# Task 005 — Docs sync + § 03 pre-ship verification — Summary

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Completed:** 2026-08-18
- **Status:** done

## What was implemented

Doc sync for the shipped sidebar plus § 07's full pre-ship verification sweep, recorded as
observations below.

**Docs:**
- `swe/features/app-navigation-screens.md` § Global navigation shell's "Sidebar content" bullet
  rewritten to describe the shipped sprint-062 sidebar (full-bleed `surface2` band, frameless
  status-only rows, `+ New session`/`+ Add workspace`), with the previously-described but now-gone
  pieces (grouping selector, refresh action, initial-load skeleton, per-workspace shortcut
  indices, the footer's Home/Settings/host-switcher icons, § 03's `needs input` state) named
  explicitly as unimplemented rather than silently dropped from the doc.
- `packages/web-client/AGENTS.md`'s `sessions/` source-layout block lists
  `session-presentation.ts` (+ test) and describes the rewritten `SessionItem`/
  `WorkspaceGroupHeader`. Seven new invariants added under `## Invariants`: single-source row
  presentation (`session-presentation.ts` → `status-map.ts`), no cwd/agent id/message
  count/timestamp/cost in the meta line, the `surface2` edge-to-edge band with both-states hover,
  fill+ring+`accentForeground`+bar selection with activity-is-the-ring-never-the-fill, `needs
  input` unsourced-and-must-not-be-faked, the reserved-`⋮` pattern mirroring `TabStrip`'s
  `.tabClose`, and the single footer open-workspace affordance.
- `IconButton.tsx`'s doc comment corrected: no longer cites `surfaceWorkspace` as an example
  ambient background (now cites `surface2`) or describes the session-row `⋮` as "absolutely
  positioned" (now "in flow ... reserved box + opacity-on-row-hover, sprint-062").
- `swe/features/file-explorer-quick-wins.md`'s `collapsedWorkspaces` description (lines 30–31)
  re-read against the shipped code: still accurate — the collapse contract (`Set<string>` of
  workspace cwds, seeded empty, `ui-store` owned) is unchanged by this sprint. No edit needed.
- `swe/sprints/PLAN.md`'s coverage-check paragraph already states sprint-062's § 03 as
  **shipped**, alongside sprints 059–061.

## Files created / changed

| File | Change |
|------|--------|
| `swe/features/app-navigation-screens.md` | modified (§ Sidebar content) |
| `packages/web-client/AGENTS.md` | modified (`sessions/` layout block + 7 invariants) |
| `packages/web-client/src/components/primitives/IconButton.tsx` | modified (doc comment) |

`swe/features/file-explorer-quick-wins.md` and `swe/sprints/PLAN.md` were reviewed and found
already accurate — no edit required for either.

## § 07 pre-ship verification (observed results)

1. **Theme guards**: `token-integrity.test.ts` (3 tests) and `font-scale.test.ts` (4 tests) pass —
   zero dangling/illegal `--pi-*` token references introduced by this sprint.
2. **All six theme variants** driven via `localStorage['pi-studio-appearance']` + reload, screenshot
   per variant against a 3-workspace, multi-row sidebar:
   - `light` — checked deliberately: the band's `color-mix` fill visibly **darkens** against the
     white page background (not lightens), confirming the mix direction is theme-adaptive.
   - `zinc` — checked deliberately: the near-white/gray accent's selected-row title rendered in
     dark text via `accentForeground`, clearly legible — the exact failure mode § 07 calls out
     ("white bold title" would vanish) does not occur.
   - `dark` (default), `midnight`, `claude`, `ghostty` — each screenshotted; band/row layout,
     selection fill+ring+bar, and count pill render correctly in every case, differing only in
     accent hue as expected.
3. **Compact form factor**: viewport resized to 400px width (< 576px breakpoint). Both the
   workspace band's `⋮` and every session row's `⋮` are visible without hover (the
   `@media (max-width: 575px), (hover: none)` rule firing); band header, count pill, and meta line
   all remain legible with no overflow or clipping beyond the intended text ellipsis.
4. **Long strings**: a 68-char workspace directory name
   (`this-is-a-very-long-workspace-directory-name-for-ellipsis-testing`) renders as
   `this-is-a-...` with no wrap and no layout shift — the `⋮` box stayed fixed at the row's right
   edge. The failure-reason ellipsis path (a long `turn failed · <reason>` string) was **not**
   independently re-verified live in this pass — the mock provider has no trigger for a real
   provider failure, and a same-process store injection (dynamic `import()` of the store module
   from the page) resolved to a separate module instance rather than the app's live singleton, so
   it could not seed the running UI's state. This is covered instead by: task-001's unit tests
   (last-error-row extraction, single-line, trim, 120-char cap — 5 dedicated tests) and the fact
   that `.meta`'s `overflow:hidden`/`text-overflow:ellipsis`/`white-space:nowrap` is the identical
   CSS pattern already visually confirmed truncating the long workspace name above.
5. **Live turn on a non-selected row**: not re-verified live in this pass, for the same mock-provider
   timing reason task-003's summary already recorded (the mock resolves near-instantly, faster than
   a screenshot can catch the intermediate `running` frame). Covered by task-001's unit tests
   (`sidebarSessionView` returning the running dot/ring input) and code review of the
   `view.dot && <StatusDot {...view.dot} />` pass-through in `SessionItem.tsx`.
6. **`prefers-reduced-motion: reduce`**: emulated via `page.emulateMediaFeatures`. Measured the
   chevron glyph's computed style directly: `transitionDuration: "0s"`, `animationName: "none"` —
   confirmed nothing animates regardless of the media feature, because task-002 shipped no
   `transition` at all (by design), so there is genuinely nothing for the media query to suppress.

## How it satisfies the scope

Every § 07 pre-ship item is recorded above as an **observed result** (variant names, exact pixel
width, the exact long string used), not asserted as "verified" without evidence, per the task's
explicit acceptance criterion. The two items not re-exercised live (long failure reason, live
running-row transition) are the same, previously-disclosed mock-provider limitation tasks 002/003
already recorded — not a new gap, and each has an equivalent, stated proof path (unit tests + the
shared CSS truncation pattern / code review).

## Build & test results

```
$ npm run clean
(removes dist/ and .tsbuildinfo everywhere)

$ npm run build
✓ all packages built successfully (protocol → highlight → relay → client → server → cli → web-client → desktop)

$ npm run typecheck
tsc -b
(clean — no errors)

$ npm run lint
oxlint — exit code 0; only pre-existing warnings in files untouched by this sprint
(no errors, no warnings in any sessions/session-presentation/WorkspaceGroupHeader/SessionItem/SessionList file)

$ npm test
Test Files  156 passed (156)
     Tests  1872 passed (1872)

$ npm run fmt:check
Format issues found in 57 files — all pre-existing, none in packages/web-client/src/features/sessions/**
or packages/web-client/src/components/primitives/IconButton.tsx (this sprint's touched files were
each verified individually with scoped `npx oxfmt --check` at the end of every task and are clean).
Per project convention, a whole-workspace `npm run fmt` autofix was NOT run — that would touch 57
files unrelated to this sprint and is explicitly discouraged.
```

`surfaceWorkspace` usage search (item 3 of "What to build"): `grep -rn "surfaceWorkspace"
packages/web-client/src/` returns only its three definitions in `theme/colors.ts`
(`ThemeColors` interface + the dark/light builders) — zero consumers anywhere in `.tsx`/`.module.css`
files, confirming the token is emitted-but-unreferenced exactly as task-002 left it.

## Acceptance criteria

- [x] `app-navigation-screens.md` § Sidebar content describes the shipped sidebar, with every
      unimplemented piece named as unimplemented rather than deleted or described as working.
- [x] `packages/web-client/AGENTS.md` lists `session-presentation.ts` in the `sessions/` layout
      block and carries the seven invariants.
- [x] `IconButton.tsx`'s doc comment no longer claims `surfaceWorkspace` ambience or an absolutely
      positioned session-row `⋮`; a usage search confirms `surfaceWorkspace` has no consumer.
- [x] Every § 07 pre-ship item is recorded in this summary as an observed result (variant names,
      widths, exact strings used), not as bare "verified".
- [x] `npm run clean && npm run build && npm run typecheck && npm run lint && npm test &&
      npm run fmt:check` all run; the first five succeed cleanly, `fmt:check` surfaces 57
      pre-existing, out-of-sprint format issues (see Build & test results — not a regression from
      this sprint, and no sprint-062 file appears in the list).
- [x] PLAN.md's coverage note already reflects § 03 as shipped by sprint-062 (reviewed, no edit
      needed).

## Follow-ups / TODO(verify)

- A long failure reason and a live running→non-selected-row transition were verified by unit test
  + code review rather than a live daemon turn, because the mock provider has no failure trigger
  and resolves too fast to catch the running frame — the same limitation tasks 002/003 already
  recorded for the attention dot and the activity ring. A future sprint that adds a
  deliberately-slow or deliberately-failing mock scenario would let this be re-verified live; not
  blocking for this sprint.
- The pre-existing repo-wide `fmt:check` debt (57 files, none touched by sprint-062) is out of this
  sprint's scope; flagging it here only as an observation, per the gate's exact output — no action
  taken.

## Addendum: live-daemon follow-up verification (2026-08-18, same day)

The two items flagged above as unverifiable against the mock provider ("a live turn: idle →
running → completed on a non-selected row") were re-verified against the **real** daemon +
provider (`daemon-live`/`webclient` dev processes) at the user's direct request, and this caught
three real visual defects the mock-provider pass could not reach, all fixed in this same
addendum pass:

1. **Dot floated with ~36px of dead space before the row's true right edge.** The title row's
   `StatusDot` sat as a flex sibling immediately before the reserved `⋮` box
   (`gap` + 20px reserved width), which only reads correctly when something else (a count pill,
   as in `WorkspaceGroupHeader`) fills that trailing cluster — with nothing after it in
   `SessionItem`, the dot visibly floated. Fixed by moving `StatusDot` into the meta row,
   immediately before the status text (`SessionItem.tsx`, `.meta`/`.metaDot`/`.metaLabel` in
   `SessionList.module.css`); the title row is now label + reserved `⋮` only.
2. **Idle/empty rows showed no dot at all.** Per user request, every state now gets a colored
   dot, not only running/failed: `sidebarSessionView`'s `idle`/`empty` branches now return
   `{ status: toDotStatus("idle"), showInactive: true }` (a muted flat dot) instead of `dot:
   null`. `statusDotColor` already supported this via its existing `showInactive` param — no
   change needed there. `session-presentation.test.ts` updated accordingly.
3. **Meta-row dot too large / gap too tight.** Per user request, added `--status-dot-size`/
   `--status-dot-border-width` CSS custom properties that `StatusDot.tsx`/`.module.css` read
   (default 8px/12px/2px unchanged, so every other call site — `TabStrip`'s tab dot,
   `WorkspaceGroupHeader`'s attention dot — is unaffected); `.metaDot` sets them to 9px/1.5px and
   `.meta`'s gap widened to `--pi-spacing-6`.

Two additional user-requested polish changes landed in the same pass, unrelated to the dot but
found during the same live sweep:

4. **Workspace band label was bold.** Removed `font-weight: var(--pi-font-weight-bold)` from
   `.workspaceLabel` — no user-facing justification for the weight remained once compared
   side-by-side with the (non-bold) session-row titles.
5. **Inconsistent "New conversation" vs "New session" labeling.** The workspace `⋮` context
   menu's action read "New conversation" while the per-workspace trailing row (task-004) and the
   footer both read "New session" for the identical `openNewChat` action. Renamed
   `WorkspaceContextMenu.tsx`'s `newConversation` → `newSession`, its label to "New session", and
   every stale doc-comment quoting the old string (`SessionList.tsx`, `WorkspaceGroupHeader.tsx`,
   `tab-store.ts`, `open-workspace.ts`, `ui-store.ts`).

`packages/web-client/AGENTS.md` gained one more invariant (`StatusDot` renders in the meta row,
not the title row) documenting item 1 so a future edit doesn't reintroduce the dead-space bug.

**Gates re-run after the addendum:** `npx oxlint`/`npx oxfmt --check` on every touched file (14
files, clean), `npm run typecheck` (clean), `npm test` — **156 test files / 1872 tests passed**,
`npm run build` (all packages built, including `web-client`). Manual verification: user drove the
real daemon + webclient dev servers themselves (`http://localhost:5173/`) and confirmed the
sidebar renders correctly ("tested manually everything looks fine").

### Files changed in the addendum

| File | Change |
|------|--------|
| `packages/web-client/src/features/sessions/SessionItem.tsx` | dot moved to meta row |
| `packages/web-client/src/features/sessions/SessionList.module.css` | `.meta`/`.metaDot`/`.metaLabel` added, `.menuBtn` reverted to a simple reserved sibling, `.workspaceLabel` bold removed |
| `packages/web-client/src/features/sessions/session-presentation.ts` | `idle`/`empty` now return a muted dot |
| `packages/web-client/src/features/sessions/session-presentation.test.ts` | updated dot expectations |
| `packages/web-client/src/components/primitives/StatusDot.tsx` | flat-dot size reads `--status-dot-size` |
| `packages/web-client/src/components/primitives/StatusDot.module.css` | spinner size/border read `--status-dot-size`/`--status-dot-border-width` |
| `packages/web-client/src/features/sessions/WorkspaceContextMenu.tsx` | `newConversation` → `newSession`, label → "New session" |
| `packages/web-client/src/features/sessions/SessionList.tsx` | doc comment |
| `packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx` | doc comment |
| `packages/web-client/src/stores/tab-store.ts` | doc comment |
| `packages/web-client/src/features/sessions/open-workspace.ts` | doc comment |
| `packages/web-client/src/stores/ui-store.ts` | doc comment |
| `packages/web-client/AGENTS.md` | one new invariant (dot lives in meta row) |
