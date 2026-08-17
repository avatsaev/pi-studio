# Task 001 — `TurnProgressBar`: indeterminate 2px sweep at the top of the chat panel

- **Sprint:** sprint-060-turn-progress-bar
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (chat)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal

Add the redesign's turn-progress indicator: an indeterminate 2px accent bar that appears across the
top of a chat pane's body — directly beneath that pane's tab strip — for exactly as long as the
pane's session is running, and disappears when the turn ends.

## Context / why

`swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 05 specifies it verbatim:

> Indeterminate 2px bar directly under the tab strip whenever the pane's session status is running:
> track accent 22%, a 38%-wide accent gradient sweeping left→right on a 1.5s linear loop. Mount on
> `turn_started`, unmount on `turn_completed` / `failed` / `canceled`. Respect
> `prefers-reduced-motion`: hold a static 100%-width track at 40% opacity instead.

§ 05's own `TurnProgressBar.module.css` block in that spec is the reference implementation; copy its
structure (`.track` / `.sweep` / `@keyframes sweep` / the reduced-motion override) rather than
inventing a second one. Everything it references already exists: `--pi-border-width-2`
(`theme/tokens.ts:100-104`), `--pi-color-accent` / `--pi-color-accentBright`, and `--pi-opacity-50`
(`tokens.ts:107-111` — the ladder has `0` / `50` / `100` only, which is why the spec's CSS writes
`var(--pi-opacity-50)` for its "40%" prose; use the token, **do not add a `40` key**).

Three grounded decisions this task locks in, because the spec was written against a mock whose
layout is not this app's:

**(a) Mount point: the top of `ChatPanel`, not the pane chrome.** `TabPanelHost.tsx:118-127` renders
one `TabStrip` per pane and `:162-184` mounts each panel in a rect *below* its strip, so the chat
panel's own top edge already **is** "directly under the tab strip". `ChatPanel.tsx:36-41` renders
`<Panel>` (a flex column, `Panel.module.css:3-8`) holding `Timeline` + `Composer`, and it already
holds the session — no new plumbing. Putting the bar in pane chrome instead would need the pane's
active-tab session resolved in `TabPanelHost` and would collide head-on with the redesign's § 06
pane-header sprint, which rewrites exactly that chrome.

**(b) Absolutely positioned, so appearing never reflows the timeline.** Mounting a 2px block as a
flex child would shift the virtualized timeline down 2px on every `turn_started` and back up on
every terminal event — a re-measure through `virtualizer.measureElement` and a fight with
stick-to-bottom autoscroll (`Timeline.tsx:106-125`) for a purely decorative element. The bar is
`position: absolute; inset-inline: 0; top: 0` inside a `position: relative` chat panel, overlaying
the timeline viewport's own top padding (`Timeline.module.css:7` — `--pi-spacing-16`, so it covers
nothing). Mount/unmount semantics stay exactly as § 05 specifies.

**(c) The trigger is `session.status === "running"`, not a `turn_started` listener.**
`hooks/agent-stream-events.ts:32-43` already maps the four events to store status
(`turn_started`→`running`, `turn_completed`→`idle`, `turn_failed`→`error`, `turn_canceled`→`idle`),
so status *is* § 05's mount rule — and reading it also covers the case a local listener cannot:
`use-session-restore.ts:151` hydrates the daemon's own `agent.status`, so a page reload during a
live turn shows the bar immediately instead of waiting for the next event.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 05 (progress-bar prose + the
  `TurnProgressBar.module.css` reference block), § 02 (token mapping), § 07 (DO NOT: no hex
  literals, no hand-rolled primitives, use the mapped token)
- `swe/features/timeline-rendering.md` § Behavior & Algorithms ("Running footer")
- `packages/web-client/src/features/chat/ChatPanel.tsx:20-42` — mount site
- `packages/web-client/src/features/chat/ChatPanel.module.css` — currently `.empty` only
- `packages/web-client/src/components/primitives/Panel.module.css:3-8` — the flex-column shell
- `packages/web-client/src/features/chat/Timeline.module.css:3-8` — viewport padding the bar overlays
- `packages/web-client/src/stores/session-store.ts:19-31,116-122` — `SessionEntry.status`
- `packages/web-client/src/hooks/agent-stream-events.ts:32-43` — the status transitions
- `packages/web-client/src/theme/tokens.ts:100-111` — `borderWidth`, `opacity`
- `packages/web-client/src/components/primitives/Dialog.module.css:72-78` — the existing
  visually-hidden recipe, if an off-screen label is used
- Create: `features/chat/TurnProgressBar.tsx` + `TurnProgressBar.module.css`
- Modify: `ChatPanel.tsx`, `ChatPanel.module.css`

## What to build

**1. `TurnProgressBar`.** One prop — the pane's session status (or a derived `running` boolean;
pick one and keep the component free of store access so it stays a dumb presentational component).
Renders `null` unless running: no DOM, no animation, nothing to hide.

**2. Styles**, transcribed from § 05's block: `.track` at `var(--pi-border-width-2)` tall with a
`color-mix(in srgb, var(--pi-color-accent) 22%, transparent)` background and `overflow: hidden`;
`.sweep` at `width: 38%` carrying the accent→`accentBright`-mixed gradient on a `1.5s linear
infinite` `sweep` keyframe from `left: -38%` to `left: 100%`. Colors are tokens; the geometry
percentages and the `1.5s` duration stay literals — this project has no motion/duration token family
(`tokens.ts` has none, and existing CSS carries raw `1.2s`/`0.7s` durations), and inventing one here
is scale churn § 07 warns against.

**3. Reduced motion.** `@media (prefers-reduced-motion: reduce)` holds the sweep static at
`width: 100%; left: 0; opacity: var(--pi-opacity-50)`. Keep it local to this module; do **not** build
a shared motion utility or retro-fit other animations. Note `--pi-opacity-50` has **no CSS consumer
yet** (`css-bridge.ts:74-76` emits it; nothing references it), so this is its first use — that is
fine, `token-integrity.test.ts` only checks the reverse direction (every `var()` resolves to an
emitted token), never that a token is used.

**4. Accessibility parity.** The indicator being deleted in task 002 is a `role="status"`
`aria-live="polite"` region whose *text* ("Agent is working…") is what a screen reader announces
(`Timeline.tsx:131-137,172-178`). A bare `role="progressbar"` with only an `aria-label` is **not**
equivalent: an indeterminate progressbar has no value to announce, so replacing text with a label
silently drops the announcement. Keep both: the track is a `role="progressbar"` (no `aria-valuenow`
— indeterminate) whose accessible name states the running state, **plus** a visually-hidden live
region carrying the announced text, using the existing recipe at
`Dialog.module.css:73-80` (`.visuallyHidden`) rather than a second one. The decorative `.sweep` is
`aria-hidden="true"`.

Both `Timeline` render sites are inside the scrolling viewport, so today the announcement rides in
the timeline; the bar sits outside it. Mount the live region with the bar — one announcement per
pane, gone when the turn ends.

**5. Mount.** `ChatPanel` renders the bar as the first child of `Panel`, with a local class adding
`position: relative` to that panel (the primitive deliberately has no `position`, so add it at the
consumer, not in `Panel.module.css`). The bar spans the full pane width — it must not inherit the
timeline's horizontal padding or any content-width cap.

## Out of scope

- Removing the existing working-dots indicator — task 002, deliberately after this one so no commit
  ever leaves the UI with no running affordance.
- Queue chips, the composer/`ModelMenu` move, and stripping the model chip from `StatusBar` — the
  rest of § 05 belongs to the composer sprint (§ 07's step 3), which this sprint does not touch.
- Pane chrome / pane headers (§ 06) and any change to `TabPanelHost`/`TabStrip`.
- Showing the bar for `initializing`, `error`, or `closed` status: § 05 says running, and a bar that
  lingers after a failed turn would read as a hung turn. Running only.
- Determinate progress, elapsed timers, token counters, or any per-turn statistic.
- Reduced-motion or animation changes anywhere outside this new module.
- Adding motion/duration tokens or an `opacity-40` key.

## Acceptance criteria

- [ ] With a turn running, a 2px accent bar animates across the top of that chat pane's body,
      flush under the pane's tab strip and spanning the pane's full width.
- [ ] The bar is absent from the DOM when the session is `idle`, `initializing`, `error` or
      `closed`, and its appearance/disappearance produces **no** vertical layout shift in the
      timeline (verified by watching a running turn start and finish with the timeline scrolled to
      the bottom — autoscroll stays pinned, no jump).
- [ ] Reloading the page during a live turn shows the bar immediately, without waiting for the next
      stream event (this is the hydrated-status path).
- [ ] In a split layout, only the pane whose session is running shows a bar; a second chat pane on an
      idle session shows none.
- [ ] Under `prefers-reduced-motion: reduce` the bar is a static full-width track at 50% opacity with
      no animation running.
- [ ] A screen reader **announces** the turn starting (the visually-hidden live region still speaks,
      as the dots' text region did — an `aria-label` alone is not equivalent for an indeterminate
      progressbar), the track exposes `role="progressbar"` with no `aria-valuenow`, and the sweep
      element is not exposed as content.
- [ ] Every color value is a `var(--pi-*)` token — no hex copied from the spec page; no new token,
      no new scale key.
- [ ] `token-integrity.test.ts` and `font-scale.test.ts` pass.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: `npx vitest run packages/web-client/src/theme` (token + font-scale guards), then
  `npx vitest run packages/web-client` for no regression. **No new test file**: the component is a
  status-keyed render with no pure logic worth a unit, and this project has no jsdom/component-test
  infrastructure by convention — UI is verified in a real browser.
- Manual (`npm run dev:daemon` + web client, mock provider is enough): start a turn and watch the
  bar mount and unmount; interrupt a turn mid-flight (`turn_canceled`) and confirm it unmounts;
  force a failing turn for `turn_failed`; reload mid-turn; split a pane with one running and one idle
  session; toggle OS/browser reduced-motion; check `dark`, `light` and `zinc` (on `light` the
  `color-mix` darkens rather than lightens — the track must still read as a tinted rule, not a black
  line).

## Notes
- **Sprint-059 seam.** `sprint-059-chat-timeline-redesign` is in flight in the same feature folder
  but a different file set (`rows/*`, `Timeline.tsx`, `rows.module.css`). This task touches only
  `ChatPanel.*` and the two new files, so the two do not overlap; re-read before editing anyway.
- **This is not the codebase's first `prefers-reduced-motion` block, and must not be planned as if it
  were.** There are zero in `packages/web-client/src` **today**, but sprint-059/task-003 introduces
  one for the streaming caret and task-005 audits every timeline animation — both land before this
  sprint runs. So follow whatever convention 059 established (same media-query shape, same
  placement inside the module) instead of inventing a second idiom; if 059 ended up with a shared
  helper, use it rather than duplicating.
- `Spinner` exists and § 07 forbids hand-rolling spinners — that rule is about *spinners*. An
  indeterminate linear bar is a different affordance § 05 specifies in CSS; do not substitute a
  `Spinner` for it, and do not restyle `Spinner` to become one.
- Keep the component free of `useSessionStore`: `ChatPanel` already subscribes to the session, and a
  second subscription in a child re-renders on every timeline mutation for a two-pixel div.
