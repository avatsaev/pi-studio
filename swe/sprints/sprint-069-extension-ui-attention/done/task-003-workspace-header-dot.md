# Task 003 — Collapsed workspace header carries the signal

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/sessions
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
While a workspace group is collapsed, an 8px `statusWarning` dot appears after the workspace name and
before the session-count pill, if any session inside it has a pending question.

## Context / why
Collapsed, the rows that carry the signal are hidden, so the group must carry it instead. Expanded,
§ 08 is explicit that a second signal one level up is noise — the rows already say it.

`workspaceAttentionDot` in `session-presentation.ts` is the function to change, and it currently states
its own limitation in a comment: needs-input is unsourceable, so `error` is the only attention signal
it can return. Sprint-068's store closes that.

This also settles a divergence: rev 1 wanted the header dot expanded *or* collapsed plus an inset
glow; § 08 defers to the handoff spec — **collapsed only, no glow**.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 08 (Workspace header: collapsed
  only, placement after the name and before the pill, the accessible name, pill stays neutral grey)
- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (the collapsed-only attention dot
  this reconciles with)
- `packages/web-client/src/features/sessions/session-presentation.ts` (`workspaceAttentionDot`)
- `packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx`
- `packages/web-client/src/features/agent-ui/agent-ui-store.ts` (sprint-068)

## What to build
- `workspaceAttentionDot` gains needs-input as a source, aggregated across the group's sessions, and
  keeps its existing failure signal. Decide and document precedence when a group contains both a
  failed session and a pending question.
- `WorkspaceGroupHeader.tsx`: render the dot only while collapsed (chevron rotated), positioned after
  the name and before the count pill, using the task-002 pulse modifier.
- Accessible name in the § 08 form: `"<workspace> — N session(s) needs input"`, with correct
  singular/plural. The dot is never the only carrier of the state.
- Avatar square, chevron and count pill otherwise unchanged; the pill stays neutral grey (it must not
  recolour to signal attention).

## Out of scope
- Expanding the group automatically, scrolling to the session, or any navigation behavior.
- The expanded-state header (it deliberately shows nothing).

## Acceptance criteria
- [ ] Collapsing a group containing a pending question shows the dot between name and pill; expanding
      it hides the dot and the rows show the signal instead.
- [ ] Two sessions pending in one collapsed group still show one dot, and the accessible name reports
      the correct count and plural form.
- [ ] Resolving the last pending question in a collapsed group clears the dot.
- [ ] A group with a failed session and a pending question renders per the documented precedence, not
      by accident.
- [ ] The count pill's colour is unchanged in every case.
- [ ] No raw px/hex.

## Test / verification plan
- Tests: extend `session-presentation`'s tests for `workspaceAttentionDot` — needs-input sourced,
  aggregation across sessions, the failure/pending precedence, and clearing. Run
  `npx vitest run packages/web-client/src/features/sessions/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Raise `#ui select` in a session, collapse its workspace group: the dot appears after the name, before
the pill, pulsing. Expand again: dot gone, row shows it. Answer the question with the group collapsed
and confirm the dot clears.

## Notes
The precedence question (failed + pending in one group) is a genuine decision this task must make and
record — § 08 does not answer it, and the handoff spec reserves tints, not dots, for failure. Prefer
whichever reads as more urgent to a user scanning a collapsed sidebar, and write the reason down.
