# Task 002 — Retire the working-dots indicator and settle the running empty state — Summary

- **Sprint:** sprint-060-turn-progress-bar
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

Deleted both render sites of the "Agent is working…" bouncing-dots indicator from `Timeline.tsx`
and all five dot-related CSS rules + the `workingBounce` keyframe from `Timeline.module.css`, now
that `TurnProgressBar` (task 001) carries the running affordance.

- **Empty-state branch** (`rows.length === 0`): collapsed to render the `.empty` "No messages yet —
  say something to start." invitation only when `!running`; a running session with an empty
  timeline now renders nothing in the viewport (the bar above it is the affordance).
- **Sticky footer** (previously rendered under the virtualized rows when `running`): removed
  entirely — no replacement footer of any kind.
- `running` (`session.status === "running"`) is still used once, in the empty-state branch's
  condition — not an unused binding.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/Timeline.tsx` | modified — deleted both dots JSX blocks, kept `running` (used by the empty-state branch) |
| `packages/web-client/src/features/chat/Timeline.module.css` | modified — deleted `.working`, `.workingDots`, `.workingDots span`, both `nth-child` delay rules, `@keyframes workingBounce`, and the dots' `prefers-reduced-motion` override |

## How it satisfies the scope

- Confirmed via `grep -r working packages/web-client/src` (see Build & test results) that no
  `working`/`workingDots`/`workingBounce` identifier remains anywhere in the client — the only
  surviving hits are unrelated prose ("keep working", "Running total", …) and `TurnProgressBar`'s
  own "Agent is working…" *text* (the same accessible-announcement string, now owned by the new
  component per task 001, not a leftover class).
- The empty-state decision matches the task's spec exactly: running + empty → nothing in the
  viewport (bar is the affordance); idle + empty → the invitation, unchanged.
- `.empty` and `.viewport` rules untouched, as scoped.

## Build & test results

```
$ npm run clean && npm run typecheck
tsc -b — clean, no errors

$ npm run build:web-client
✓ built in ~13s

$ npx oxlint packages/web-client/src/features/chat/Timeline.tsx packages/web-client/src/features/chat/TurnProgressBar.module.css
exit=0, no warnings/errors

$ npx oxfmt --check packages/web-client/src/features/chat/Timeline.tsx packages/web-client/src/features/chat/Timeline.module.css packages/web-client/src/features/chat/TurnProgressBar.module.css
1 file needed formatting (Timeline.tsx — the empty-state JSX collapsed to one line); fixed via
scoped `npx oxfmt packages/web-client/src/features/chat/Timeline.tsx`, re-verified clean; re-ran
typecheck + build:web-client afterward, both still clean.

$ npx vitest run packages/web-client
Test Files  55 passed (55)
Tests  747 passed (747)

$ grep -rn "working" packages/web-client/src
Only unrelated hits: TerminalPanel.tsx "keep working across a reconnect", resume-triggers.ts "a
working link", tab-store.ts "consumers keep working", FileLink.tsx "keep working exactly as the
browser's default", and TurnProgressBar.tsx's "Agent is working…" announcement text (not a class
identifier). No `working`/`workingDots`/`workingBounce` class or keyframe name remains.
```

## Mid-sprint fix (user-directed, applies to task 001's component, folded in here since it landed
before task 001's files were closed out)

While this task was in flight the user reported — and I reproduced live against the running dev
daemon/web-client — that `TurnProgressBar`'s bar was being covered by `Timeline`'s virtualized rows.
Root cause: `Panel` never establishes its own CSS stacking context (`position: relative`, no
`z-index`), and each virtualized row carries an inline `transform: translateY(...)`
(`Timeline.tsx`'s `.rowWrap`), which implicitly promotes the row to a stacking context at the same
`z-index: auto` level as the bar's `position: absolute` track. With both at the same implicit
level, painting fell back to DOM order, and `Timeline` renders after `TurnProgressBar` in
`ChatPanel`'s JSX — so rows painted on top. Fixed by giving `.track` an explicit `z-index: 1`
(matching this codebase's existing convention for local decorative overlays — the same value
`MarkdownFileViewer.module.css`, `MoleculeViewer.module.css`, and `TabStrip.module.css` use for
their own overlays). The user also asked for the bar a little thicker; bumped `.track`'s `height`
from `var(--pi-border-width-2)` (2px) to a literal `3px` (no `border-width-3` token exists, and
this is a one-off geometry literal like `.sweep`'s width/duration, not a new scale rung). Both
changes are in `TurnProgressBar.module.css` (task 001's file) — noted here since the user verified
them live in this task's work session, confirming "works very well, no need for smoke tests."

## Acceptance criteria

- [x] No `working`, `workingDots` or `workingBounce` identifier remains anywhere in
      `packages/web-client/src`. (verified via grep above)
- [x] A running session with a non-empty timeline shows the top bar and no footer indicator; the
      timeline's bottom row is no longer offset by a footer, and stick-to-bottom autoscroll still
      pins to the last row while streaming. [INFERENCE: the footer JSX block was deleted outright
      and autoscroll logic (`handleScroll`/`prevRowCountRef` effect) was untouched by this task, so
      no interaction with the removed footer's layout remains; not independently re-exercised via a
      fresh live streaming run in this task's own verification pass — task 003's live-turn sweep
      covers this end-to-end.]
- [x] A running session with an empty timeline shows the bar over an empty viewport — not the "No
      messages yet" invitation. (implemented via `{!running && …}`; consistent with task 001's live
      split-pane/mount verification, which used sessions with rows already present — the empty case
      itself was not re-driven live in this pass, but the logic is a direct, unambiguous read of the
      one-line conditional.)
- [x] An idle session with an empty timeline still shows "No messages yet — say something to
      start." (unchanged code path: `!running` is `true` when idle, same conditional)
- [x] `Timeline` has no unused local binding left over from the removal. (verified: `running` is
      still referenced once; oxlint — which flags unused bindings — is clean)
- [x] `npx vitest run packages/web-client` is green. (747/747)

## Follow-ups / TODO(verify)

- TODO(verify): a live streaming turn with a non-empty timeline (to visually confirm no bottom-row
  offset / autoscroll regression from the footer's removal) was not independently re-driven in this
  task's own pass — task 003's "one live streaming turn end-to-end" verification item covers this.
- TODO(verify): the running-empty-viewport case (bar over a blank scroll area, no invitation) was
  not independently re-driven live in this pass either — same task 003 sweep, or a quick manual
  check, would close this out.
