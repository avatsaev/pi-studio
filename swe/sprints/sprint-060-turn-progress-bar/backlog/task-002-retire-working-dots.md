# Task 002 — Retire the working-dots indicator and settle the running empty state

- **Sprint:** sprint-060-turn-progress-bar
- **Status:** backlog
- **Type:** chore
- **Area:** packages/web-client (chat timeline)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Delete the "Agent is working…" bouncing-dots indicator — both render sites and all of its CSS — now
that the progress bar carries the running signal, and decide what a running session with an empty
timeline shows instead.

## Context / why

The dots are the placeholder the redesign replaces. `sprint-059/task-002` and `task-005` both
explicitly left them alive and named this sprint as their owner ("it stays until the TurnProgressBar
sprint replaces it (deliberate: do not leave a gap with no running affordance)"), so this is the task
that closes that loop — and it depends on task 001 so the gap never exists.

Two render sites, not one (`Timeline.tsx`):

- the **empty-state branch** (`rows.length === 0`), where the dots *replace* the "No messages yet —
  say something to start." invitation while running (`:127-144`);
- the **sticky footer** under the virtualized rows (`:171-180`).

CSS: `.working`, `.workingDots`, `.workingDots span` + its two `nth-child` delays, and
`@keyframes workingBounce` (`Timeline.module.css:34-75`) — nothing else references them (grep
`working` across `packages/web-client/src`; the only other hits are prose).

**The empty-state decision.** With the dots gone, `rows.length === 0 && running` would fall through
to "No messages yet — say something to start." — an invitation to do the thing the agent is currently
doing, which is worse than the blank it replaces. Render **nothing** in the viewport for that state:
the bar above it is the affordance, and the first row lands within a beat. Keep the invitation for
the genuinely idle empty session.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 05 (the bar is the running affordance),
  § 07 (DO NOT hand-roll dots/spinners)
- `packages/web-client/src/features/chat/Timeline.tsx:127-144` (empty state), `:171-180` (footer),
  `:66` (`const running = session.status === "running"`)
- `packages/web-client/src/features/chat/Timeline.module.css:34-75` (all dot styles + keyframes)
- `packages/web-client/src/features/workspace/pane-layout-view.test.ts:66-70` — the only test file
  that mentions `Timeline` at all, and only in a comment about virtualizer measurement: no test
  asserts the indicator, so nothing needs rewriting
- Modify: `Timeline.tsx`, `Timeline.module.css`

## What to build

**1. Delete both JSX blocks.** The empty-state branch collapses to the `.empty` invitation when not
running and to an empty viewport when running; the footer block goes entirely. Drop `running` from
`Timeline` if nothing else in the component uses it after the removal — leaving a computed-but-unused
binding behind is exactly the dead weight this task exists to remove.

**2. Delete the CSS.** All five rules plus the keyframe. Confirm by searching for each class name
across `packages/web-client/src` before deleting, not by eye — a class referenced only from a JSX
branch you just deleted still *looks* used inside the CSS file.

**3. Leave `.empty` and `.viewport` untouched.** They serve the idle empty session and the scroll
container.

## Out of scope

- Any other rule in `Timeline.module.css`, and any `rows.module.css` sweep —
  `sprint-059/task-005` owns the row-level dead-style pass.
- Re-introducing a footer affordance of any kind (elapsed timer, spinner, status text). § 05 puts one
  indicator per pane, at the top.
- Touching `Composer.tsx`'s Stop button or the steering placeholder — independent affordances that
  stay exactly as they are.
- Docs updates — task 003.

## Acceptance criteria

- [ ] No `working`, `workingDots` or `workingBounce` identifier remains anywhere in
      `packages/web-client/src`.
- [ ] A running session with a non-empty timeline shows the top bar and no footer indicator; the
      timeline's bottom row is no longer offset by a footer, and stick-to-bottom autoscroll still
      pins to the last row while streaming.
- [ ] A running session with an empty timeline shows the bar over an empty viewport — **not** the
      "No messages yet" invitation.
- [ ] An idle session with an empty timeline still shows "No messages yet — say something to start."
- [ ] `Timeline` has no unused local binding left over from the removal.
- [ ] `npx vitest run packages/web-client` is green (no test asserted the indicator).

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds (run `npm run clean` first if a signature changed earlier
  in the sprint — stale `.tsbuildinfo` makes incremental typecheck miss errors).
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean. Lint must be
  clean specifically because an orphaned `running` binding is exactly what oxlint catches here.
- Tests: `npx vitest run packages/web-client`.
- Manual: `npm run dev:daemon` + web client — open a brand-new chat, send a prompt, and watch the
  transition from empty+running to first row with no dots and no layout jump; then a long streaming
  turn scrolled to the bottom to confirm autoscroll is unaffected by the removed footer.

## Notes
- **Sprint-059 seam.** `Timeline.tsx` is being actively edited by the in-flight
  `sprint-059-chat-timeline-redesign` (its `renderRow` signature and row wrapper are changing), so
  the line numbers above will have drifted. Re-read the file and locate the two `role="status"`
  blocks by shape, not by line. The change is two self-contained deletions and does not conflict with
  that sprint's row work.
- If `sprint-059/task-005`'s reduced-motion audit has already landed, it may have added a
  `prefers-reduced-motion` override for `workingBounce`; delete that with the keyframe.
