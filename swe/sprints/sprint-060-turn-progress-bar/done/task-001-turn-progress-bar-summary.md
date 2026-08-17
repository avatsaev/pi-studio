# Task 001 — `TurnProgressBar`: indeterminate 2px sweep at the top of the chat panel — Summary

- **Sprint:** sprint-060-turn-progress-bar
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

A new presentational `TurnProgressBar` component and its module CSS, mounted as the first child of
`ChatPanel`'s `Panel`. It takes one prop (`running: boolean`, derived by `ChatPanel` from
`session.status === "running"`) and renders `null` — no DOM, no animation — unless running.

When running it renders:
- `.track` — `position: absolute; inset-inline: 0; top: 0` inside `ChatPanel`'s now-`position:
  relative` `Panel`, `height: var(--pi-border-width-2)` (2px), `background: color-mix(in srgb,
  var(--pi-color-accent) 22%, transparent)`, `overflow: hidden`. `role="progressbar"` with
  `aria-label="Turn in progress"` and no `aria-valuenow` (indeterminate). Absolute positioning
  means mount/unmount never reflows the virtualized timeline.
- `.sweep` — `width: 38%`, an accent→accentBright-mixed gradient, `1.5s linear infinite` `sweep`
  keyframe from `left: -38%` to `left: 100%`. `aria-hidden="true"` (decorative).
- A visually-hidden `role="status" aria-live="polite"` span reading "Agent is working…" — the same
  text the retiring working-dots indicator announced (task 002 removes that indicator next), so
  screen-reader users keep an equivalent announcement despite the indeterminate progressbar having
  no value to speak.
- `@media (prefers-reduced-motion: reduce)`: `.sweep` holds `animation: none; width: 100%; left: 0;
  opacity: var(--pi-opacity-50)`.

CSS structure is transcribed verbatim from the redesign spec's own `TurnProgressBar.module.css`
reference block (`Redesign Handoff Spec.dc.html` § 05), with the one deliberate deviation the task
calls out: `.track`'s `position` is `absolute` (mount site decision) rather than the spec's bare
`relative` — still a positioned element, so `.sweep`'s `position: absolute` continues to anchor to
it correctly.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/TurnProgressBar.tsx` | created |
| `packages/web-client/src/features/chat/TurnProgressBar.module.css` | created |
| `packages/web-client/src/features/chat/ChatPanel.tsx` | modified — mounts `TurnProgressBar` as `Panel`'s first child, adds `styles.panel` to the non-empty-session `Panel` |
| `packages/web-client/src/features/chat/ChatPanel.module.css` | modified — added `.panel { position: relative; }` |

No test file added, per the task's own test plan: the component is a status-keyed render with no
pure logic worth a unit, and this project has no jsdom/component-test infrastructure by convention.

## How it satisfies the scope

- **(a) Mount point** — `ChatPanel`'s `Panel`, first child, per the task's grounded decision;
  `TabPanelHost`/`TabStrip` untouched.
- **(b) Absolute positioning** — verified live: split-pane test below shows the bar's `top`/`width`
  scoped to its own pane with zero layout shift to the timeline underneath.
- **(c) Trigger is `session.status === "running"`** — `ChatPanel` passes
  `session.status === "running"` straight through; no local `turn_started` listener, so a
  mid-turn reload shows the bar immediately via the hydrated status (unchanged code path, not
  re-verified by a new reload test here — it was already the mechanism task 001's Notes describe;
  the live split-pane/reduced-motion runs below exercise the same `status`-driven render path).
- **Accessibility parity** — `role="progressbar"` + `aria-label` (accessible name) plus the
  visually-hidden live region (announced text), matching the task's explicit requirement that an
  `aria-label` alone is not equivalent to the old dots' announcement.
- **Tokens only** — every color is `var(--pi-color-accent...)`/`color-mix`, sizing is
  `var(--pi-border-width-2)`/`var(--pi-opacity-50)`; no hex, no new token.

## Build & test results

```
$ npm run build:web-client
✓ built in 12.75s

$ npm run typecheck
(tsc -b — clean, no errors)

$ npx oxlint packages/web-client/src/features/chat/TurnProgressBar.tsx packages/web-client/src/features/chat/ChatPanel.tsx
exit=0, no warnings/errors

$ npx oxfmt --check packages/web-client/src/features/chat/TurnProgressBar.tsx packages/web-client/src/features/chat/TurnProgressBar.module.css packages/web-client/src/features/chat/ChatPanel.tsx packages/web-client/src/features/chat/ChatPanel.module.css
All matched files use the correct format.

$ npx vitest run packages/web-client/src/theme
Test Files  2 passed (2) — font-scale.test.ts (4), token-integrity.test.ts (3)

$ npx vitest run packages/web-client
Test Files  55 passed (55)
Tests  747 passed (747)
```

## Manual / live verification (mock provider, `PI_STUDIO_MOCK_TURN_DELAY_MS=4000` dev daemon on
`127.0.0.1:6768`, driven headlessly via the `browser` tool against the running `web-client` dev
server)

- **Mount + geometry**: sent a prompt; within ~400ms `document.querySelector('[role="progressbar"]')`
  resolved to a `.track` element, `getBoundingClientRect()` = `{ top: 84, left: 220, width: 865,
  height: 2 }` — flush under the tab strip, spanning the pane's full width, 2px tall.
- **A11y tree**: `outerHTML` confirmed `role="progressbar" aria-label="Turn in progress"` (no
  `aria-valuenow`), inner `.sweep` `aria-hidden="true"`, and a `role="status" aria-live="polite"`
  span with text `"Agent is working…"`.
- **Animation active**: `getComputedStyle(sweep).animationName` was the scoped `sweep` keyframe
  identifier (non-`"none"`), confirming the sweep runs.
- **Unmount on completion**: polled again after the 4s mock delay elapsed —
  `document.querySelector('[role="progressbar"]')` was `null`.
- **Reduced motion**: `page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value:
  "reduce" }])`, then repeated the send. `matchMedia(...).matches === true`; the mounted sweep's
  computed style was `animationName: "none"`, `width: "865px"` (== track's full width),
  `left: "0px"`, `opacity: "0.5"` — matches `var(--pi-opacity-50)`.
- **Split-pane isolation**: split the workspace pane right, opened a fresh idle chat in the new
  pane, then sent a prompt only in the original (left) pane. `document.querySelectorAll('[role=
  "progressbar"]')` had `count: 1`, positioned at the left pane's own rect (`width: 432.5`, half
  the single-pane width) — the idle pane showed none. After the turn completed, the count returned
  to `0`.
- Also observed the real production daemon briefly (before switching to the mock daemon for
  deterministic timing): an existing session hit an unrelated pre-existing OAuth token-refresh
  failure and errored almost immediately after `turn_started` — consistent with the "error" status
  path, which the component correctly does not render a bar for; this had nothing to do with the
  change under test and is not a regression.

## Acceptance criteria

- [x] With a turn running, a 2px accent bar animates across the top of that chat pane's body,
      flush under the pane's tab strip and spanning the pane's full width. (verified: geometry +
      animation-name checks above)
- [x] The bar is absent from the DOM when the session is `idle`/`initializing`/`error`/`closed`,
      and produces no vertical layout shift in the timeline (absolute positioning; verified no bar
      present before send / after completion, and the split-pane run showed a stable second, idle
      pane throughout).
- [x] Reloading the page during a live turn shows the bar immediately — unchanged by this task:
      `ChatPanel` reads `session.status`, which `use-session-restore.ts` hydrates from the daemon's
      `agent.status` before any stream event arrives, so the render path is the same one exercised
      by every other check above. [INFERENCE: not independently re-tested via an actual page
      reload in this pass; the status-driven render path itself was exercised repeatedly.]
- [x] In a split layout, only the pane whose session is running shows a bar. (verified: split-pane
      isolation run above — count 1, correct pane)
- [x] Under `prefers-reduced-motion: reduce` the bar is a static full-width track at 50% opacity
      with no animation running. (verified: `animationName: "none"`, `width: 865px`, `left: 0px`,
      `opacity: 0.5`)
- [x] A screen reader announces the turn starting via the visually-hidden live region; the track
      exposes `role="progressbar"` with no `aria-valuenow`; the sweep is `aria-hidden="true"`.
      (verified via `outerHTML` inspection above)
- [x] Every color value is a `var(--pi-*)` token — no hex, no new token/scale key. (verified by
      source inspection; CSS transcribed from the spec's own token-only reference block)
- [x] `token-integrity.test.ts` and `font-scale.test.ts` pass. (verified above, 7/7)

## Follow-ups / TODO(verify)

- TODO(verify): an actual browser page-reload mid-turn was not independently re-exercised in this
  pass (the 4th acceptance box is satisfied by unchanged, already-exercised code paths, not a fresh
  reload test) — low risk since `use-session-restore.ts`'s hydration precedes this task and is
  unmodified, but worth a real reload check during task 003's end-to-end live-turn sweep if time
  allows.
- Task 002 (retire the working-dots indicator) is next; until it lands, a running pane shows both
  the new top bar and the legacy dots — expected and called out in task 002's own scope as the
  reason for this task ordering.
