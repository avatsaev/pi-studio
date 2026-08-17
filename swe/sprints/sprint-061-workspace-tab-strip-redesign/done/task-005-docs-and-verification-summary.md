# Task 005 — Docs sync, stale spec-path sweep, § 07 pre-ship verification — Summary

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

**1. `swe/features/workspace-ui.md` § Desktop tab strip** rewritten end-to-end to describe the
shipped strip: the 36px band and its single `--pane-strip-height` declaration, the 24px pill
geometry, the shrink-then-scroll truncation contract, the per-kind leading glyph, the attention
`StatusDot`, the reserved/opacity-gated close, and the trailing-chrome order. Two reference-app
behaviors marked explicitly unimplemented rather than silently dropped (skeleton bars for loading
tabs; per-tab context menu / tooltip beyond the native `title`), plus the attention dot's missing
"needs input" source (this app's session-status enum has no `waiting`).

**2. `packages/web-client/AGENTS.md`.** Rewrote the `workspace/` layout entry's `TabStrip` line to
the shrink-then-scroll model and added `tab-attention.ts` (+ test) to the file list. Added a new
**"Workspace tab strip (sprint-061)"** Invariants entry (placed beside "Turn progress bar
(sprint-060)") stating the six traps: the single height declaration and why it's `--pane-*` not
`--pi-*`; tabs-shrink/chrome-doesn't; the reserved opacity-gated close box; "+" staying outside
`SortableContext`; `Icon`-only glyphs; and the attention dot as a status projection with the active
tab deliberately excluded.

**3. Stale-path sweep.** `swe/design/redesign 0.1.0/` → `swe/UI design/redesign 0.1.0/` fixed at the
three remaining living-doc citations: `swe/sprints/PLAN.md` lines 91, 1089, 1183, and
`swe/features/timeline-rendering.md` lines 46, 171, 248. `sprint-059`/`sprint-060`'s `done/` task
files were left untouched, per the plan's own audit-trail rule — PLAN.md's coverage-check redesign
paragraph (written during this sprint's planning) already explains the rename and why those files
keep the old path.

**4. PLAN.md bookkeeping.** The sprint-061 row, task index, and coverage entry were already added at
planning time (before this task ran) and were re-verified against the shipped source rather than
rewritten. The "remaining unplanned redesign work" sentence already excluded the tab strip / pane
chrome (it names only the sidebar, the rest of § 05, and § 06) and already credits
`sprint-061/task-005` — no edit needed there.

**5. § 07 verification sweep** — see below, executed live against an isolated mock-provider dev
daemon + dev `vite` server (never the user's own real daemon on `:6767`/`:5173` — see Notes).

## Files created / changed

| File | Change |
|------|--------|
| `swe/features/workspace-ui.md` | § Desktop tab strip rewritten |
| `packages/web-client/AGENTS.md` | `workspace/` layout line rewritten; new "Workspace tab strip (sprint-061)" Invariants entry; reformatted by scoped `oxfmt` (content unchanged, only reflow) |
| `swe/sprints/PLAN.md` | 3 stale-path citations fixed (lines 91, 1089, 1183) |
| `swe/features/timeline-rendering.md` | 3 stale-path citations fixed (lines 46, 171, 248) |

## How it satisfies the scope

- Every rule stated in the new AGENTS.md invariants and the rewritten workspace-ui.md section is
  traceable to a line of shipped source (`--pane-strip-height` declaration site, `.tabs`/`.tab` flex
  values, `.tabClose`'s opacity rules, `tab-attention.ts`'s signature) — cross-checked against the
  four prior tasks' summaries and the source files directly while writing.
- No source change beyond what tasks 001-004 shipped — this task touched only docs.
- `sprint-059`/`sprint-060` `done/` files were not rewritten for the folder rename — verified by the
  final stale-path grep below, which finds hits only in those two sprints' `done/` folders and this
  sprint's own `task-005` file (which legitimately *describes* the old path as part of explaining the
  fix, not a stale citation).

## Build & test results — full gates from a clean state

```
$ npm run clean
(clean, no output)

$ npm run build            (full, dependency-ordered — protocol/highlight/relay/client/server/cli/web-client)
✓ all packages built; web-client bundle built in ~13s (pre-existing >500kB chunk-size warnings only,
  unrelated to this sprint)

$ npm run typecheck
tsc -b — clean, no errors

$ npm run lint
exit=0; 0 errors repo-wide; pre-existing warnings only on files this sprint never touched — verified
by grepping the full lint log for TabStrip/TabPanelHost/pane-layout-view/tab-attention: zero hits.

$ npm run fmt:check
exit=1 repo-wide (pre-existing debt — same shape sprint-060 reported: server docs, various
package.json/*.ts, DESIGN_SYSTEM.md, paths.ts, etc.). One genuine hit on a file this sprint touched
(`packages/web-client/AGENTS.md`) was found and fixed with a scoped `npx oxfmt
packages/web-client/AGENTS.md` (confirmed via `git stash` that the file was correctly formatted
before this sprint's edit, so the reflow was introduced by this task's insertion, not pre-existing
debt) — re-checked clean afterward, content verified unchanged (only re-flow). Re-ran the full
`fmt:check` afterward and grepped for every sprint-061-touched file: zero hits.

$ npm test                 (full suite)
Test Files  155 passed (155)
Tests  1846 passed (1846)
```

## § 07 verification sweep — recorded as observed, not assumed

Driven live via the `browser` tool against an **isolated** mock-provider dev daemon
(`node packages/server/dist/daemon/dev-main.js`, `PI_STUDIO_LISTEN=127.0.0.1:6790`,
`PI_STUDIO_MOCK_TURN_DELAY_MS=6000`) and an isolated `vite` dev server
(`packages/web-client`, port 5190) — both started and stopped via `hub`, deliberately separate
from the user's own real daemon (`:6767`) and web dev server (`:5173`), which were already running
and are the user's live session. See Notes for one incident where the browser session briefly
reconnected to the wrong (real) daemon after a page reload, and how it was caught and resolved.

- **Strip height (36px, single declaration).** `getBoundingClientRect()` on `.paneStrip` returned
  `{ height: 36 }` in both a single-pane workspace and a 2×2-equivalent split; both panes' strips
  measured identically (`y: 51, height: 36`) confirming the shared `--pane-strip-height` variable.
- **Pill geometry.** Active pill: `border-radius: 6px` (`radius-md`), `height: 24px`
  (`getBoundingClientRect()`), background `rgb(39, 42, 41)` (dark `surface2`). Truncation: opening
  `docs/molviewer-integration-scope.md` (31-char name) produced a pill capped at exactly `width:
  200px` with `label.scrollWidth (217) > label.clientWidth (140)` — ellipsis confirmed active, no
  wrap (single-line row visible in screenshot).
- **Shrink-then-scroll under real overflow.** Split the workspace pane right (two 450px-wide
  strips, both `height: 36` and pixel-aligned), then added tabs to one pane until it held 9 tabs.
  `.tabs`' `scrollWidth (592) > clientWidth (362)` confirmed real horizontal overflow; pills had
  shrunk to their `64px` floor (`pillWidths: [64, 64, 64, 73, 89]` at 5 tabs, before adding more).
  With 9 tabs overflowing, `.stripActions` (`x: 614-662`) and the "+" button (`x: 592-612`) both
  measured **inside** the 450px strip's bounds (`right: 670`) — fully visible and reachable without
  scrolling, confirmed by a screenshot showing every trailing control at icon-only floor width with
  no clipping.
- **Icon routing + active-chat accentBright.** The active chat tab's leading `<svg>` had
  `stroke="var(--pi-color-accentBright)"` (not a CSS `color`, since lucide's `color` prop sets the
  SVG `stroke` attribute directly — confirmed by reading the attribute, not `getComputedStyle`).
  Every other tab's icon inherited `currentColor`.
- **Attention dot, live, end-to-end.** Sent a mock chat turn, then switched the pane's active tab
  away from that chat mid-turn: the (now inactive) chat pill grew a
  `<span class="_spinner_… _tabDot_…">` with `border-top/right-color: var(--pi-color-accentBright,
  #a2b4d7)` — the exact `StatusDot` spinning-ring markup. After the mock's 6s turn delay elapsed,
  re-querying the DOM found the dot element gone entirely (`StatusDot` returns `null` for `idle`,
  so no leftover empty node) — matching task-004's acceptance criteria live, not just via unit test.
- **Theme variants.**
  - **dark** (default): covered by every screenshot above.
  - **light**: switched via the real `pi-studio-appearance` localStorage key + reload (the same
    persisted-setting mechanism `createAppearanceController`/`ThemeBoundary` consume — not a
    CSS-var hack). Active pill: `background: rgb(244, 244, 245)`, text `rgb(26, 26, 30)`; inactive:
    transparent, muted `rgb(113, 113, 122)`. Clearly legible, matches the "hover mix darkens on
    light" design intent by construction (`color-mix` against a light `--pi-color-background`).
  - **zinc**: `--pi-color-accentBright` resolved to `#fafafa` (near-white). Active **chat** tab
    (not just any active tab) was opened specifically to test the § 07 risk case: pill background
    `rgb(39, 39, 42)` (zinc's dark `surface2`) with the icon rendering at the near-white
    `accentBright` stroke — screenshot confirms strong, unambiguous contrast; no low-contrast
    finding.
- **Compact / coarse pointer.** Headless Chromium in this environment natively reports
  `matchMedia('(hover: none)').matches === true` (no real pointing device) — this is a genuine,
  organic exercise of the `@media (max-width: 575px), (hover: none)` branch, not a simulated one:
  every tab's × was visible without any hover, confirmed across every screenshot above. Also
  confirmed the desktop `TabStrip` (not the separate mobile switcher UI) still renders at a 700px
  viewport with full trailing-chrome reachability in a compressed 200px-wide two-tab strip.
- **Split panes.** 2×2-equivalent split (right + the left pane further loaded with tabs): each
  strip highlighted its own pane's active tab independently (verified via `.tabActive` class +
  screenshot), both strips' geometry was pixel-identical, and reorder/drag machinery was left
  untouched by this sprint (no dnd-kit wiring was edited in any of tasks 001-004) — not
  independently re-driven as a live drag in this pass (see TODO(verify)).
- **A live turn + `TurnProgressBar`.** Not independently re-screenshotted for the progress bar's own
  geometry in this task's pass (that was task-004's manual step, verified via the DOM-level
  attention-dot check instead, which exercises the same running-session code path); the attention
  dot's disappearance-on-completion check above is the direct evidence that the running/idle
  transition works correctly end-to-end.

## Acceptance criteria

- [x] `swe/features/workspace-ui.md` § Desktop tab strip describes the shipped strip, with both
      unimplemented reference-app behaviors and the missing needs-input source explicitly marked.
- [x] `packages/web-client/AGENTS.md`'s workspace layout entry matches the shipped file set
      (including `tab-attention.ts`), and its Invariants section carries six rules, each with a
      reason.
- [x] No living doc still cites `swe/design/redesign 0.1.0/` — verified by search (only
      `sprint-059`/`sprint-060`'s `done/` files and this task's own descriptive mention remain).
      `done/` task files are untouched; PLAN.md's coverage-check paragraph (already present from
      planning) explains why.
- [x] PLAN.md's remaining-redesign-work sentence does not list the tab strip / pane chrome as
      unplanned, and sprint-061's coverage entry names `features/workspace-ui.md` — both were
      already correct as planned; re-verified rather than blindly re-edited.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check` (for every file this
      sprint touched — the command itself has pre-existing repo-wide debt, documented above) and
      `npm test` all pass from a clean state (`npm run clean` first).
- [x] Every § 07 VERIFY item is recorded above as an observation, with genuine gaps written as
      `TODO(verify)` below rather than assumed.

## Notes

- **Incident, caught and resolved:** after reloading the browser page mid-verification (to apply a
  new persisted theme setting), the connection field reset to its default suggestion text
  (`ws://127.0.0.1:6767` — the user's own real production daemon) and a stray `Connect` click
  landed there instead of the isolated mock daemon on `:6790`. Caught immediately (the workspace
  list showed real git history/diff stats instead of the mock daemon's in-memory state) and
  disconnected within seconds. No session/terminal was created against the real daemon — the only
  action taken was re-opening two already-known file-view tabs (read-only), which the client's own
  `reopen-client-tabs.ts` replayed from this browser's locally persisted tab state. Every subsequent
  reconnect in this task explicitly filled the URL field before clicking Connect.
- Match each doc's existing structure/voice — confirmed by keeping `workspace-ui.md`'s bullet
  format and `AGENTS.md`'s existing Invariants-entry shape (bold header + sub-bullets, matching
  "Turn progress bar (sprint-060)" immediately above it).
- `AGENTS.md:1156-1160`'s `closeTab` invariant (every close path goes through the wrapper so an
  empty chat session is discarded) was re-read against task-002's markup change: the × handler
  (`onClick` → `ev.stopPropagation()` → `closeTab(tab.id)`) is byte-identical to before, only its
  visual wrapper (`<Icon>` instead of a raw `<X>`) changed — confirmed still true.
- No genuine visual defect was found during the sweep; nothing needed fixing beyond the
  `AGENTS.md` formatting reflow above.

## Follow-ups / TODO(verify)

- TODO(verify): a live drag-reorder / cross-pane-move / edge-split gesture was not independently
  re-driven with the `browser` tool in this pass (dnd-kit pointer-drag automation is high-effort to
  script reliably headlessly); the underlying logic is untouched by tasks 001-004 and covered by
  `pane-dnd.test.ts`/`pane-tree.test.ts` (both green, unedited), but a real-mouse drag was not
  re-screenshotted end-to-end against the redesigned pill markup specifically.
- TODO(verify): `TurnProgressBar`'s own geometry (flush under the 36px border, full pane width) was
  not re-screenshotted in this task's pass — task-004's attention-dot check exercises the identical
  `session.status === "running"` code path as corroborating evidence, but the bar's own pixels were
  last independently measured in sprint-060/task-001's pass, before this sprint's 33→36px band
  change. Low risk (the bar's `top: 0` is relative to its own pane, not a hardcoded offset), but not
  formally re-measured here.
- TODO(verify): the desktop-only "hover reveals an inactive tab's ×, unhover hides it" behavior
  could not be isolated in this headless pass — Chromium's CDP `Emulation.setEmulatedMedia` in this
  version rejects `hover`/`pointer` as emulatable features, and the environment's native `hover:
  none` state means the `@media (hover: none)` always-visible branch masks the hover-only branch
  entirely. The rule was verified by source inspection (`.tab:hover .tabClose { opacity: 1 }`) and
  is architecturally simple (a single CSS selector), but a real pointer-device browser session would
  be needed to observe the reveal/hide transition directly.
