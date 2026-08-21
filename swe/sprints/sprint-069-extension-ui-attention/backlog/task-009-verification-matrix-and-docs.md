# Task 009 — Verification matrix, cross-surface consistency pass, docs

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** docs
- **Area:** web-client / docs, swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008

## Goal
Close the sprint: one consolidated matrix for the user's sign-off, an explicit check that the same
state looks the same on all three attention surfaces, and docs updated.

## Context / why
This sprint's signals are deliberately the *same* state rendered in four places (row, collapsed header,
tab, announcement). That is exactly the kind of work where each task passes on its own and the set
drifts — one surface pulsing and another not, one clearing on a slightly different trigger, an
accessible name present in two places and missing in a third. § 08's "applied on all three surfaces so
the same state looks the same everywhere" is a cross-surface requirement no single task owns.

Visual sign-off is the user's (direction, 2026-08-21), so the deliverable is one ordered walk-through
rather than per-task claims.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 08, § 11, § 13
- `packages/web-client/AGENTS.md`, root `AGENTS.md`, `swe/sprints/PLAN.md`
- `swe/features/ui-components.md` § Feedback (the toast catalog entry task-005 implements — check it
  now describes what shipped)

## What to build
- **Verification matrix** in the task summary, ordered for one sitting: needs-input on a background
  row; running-vs-needs-input precedence; clearing on answer/dismiss/expiry and *not* on mere opening;
  two questions on one session showing one signal; collapsed header dot with the count in its
  accessible name; expanded header showing nothing; inactive-tab dot with active-tab suppression;
  narrow-strip concession order; pulse present on all three surfaces and absent elsewhere; reduced
  motion killing all three pulses; each `notify` level; error-toast persistence and hover-pause;
  `set_editor_text` visible replacement (both note copies) plus the background-pane deferred **note**
  (no flash) firing once; the seven
  announcements including the two silent cases.
- **Cross-surface consistency check** — one deliberate pass confirming: identical dot size and colour
  in all three places, identical clearing trigger, pulse on all three, an accessible name on every
  dot, and no surface reacting to a state the others ignore.
- **Docs** — `packages/web-client/AGENTS.md`: the toast host (new primitive, its store and viewport,
  the `warning` variant), the effect-routing seam, the attention sources added to
  `session-presentation.ts`/`tab-attention.ts`, the `attentionReason: "question"` vocabulary change,
  and the announcement region. Root `AGENTS.md`: update the `agent_ui_*` paragraph — dialogs *and*
  attention badging *and* transients now render; retained surfaces (§ 09/§ 10) still do not, so say so
  rather than implying full coverage. `swe/features/ui-components.md` § Feedback: the toast entry is no
  longer aspirational — reword it to describe what exists. `PLAN.md`: mark the sprint.
- Confirm sprint-068/task-009's filed spec corrections were resolved; in particular § 08's row-wash
  contradiction, which task-001 had to decide with or without an answer. If task-001 shipped the
  fallback, say so plainly in the summary so the designer's later answer can be applied deliberately.

## Out of scope
- Any § 09/§ 10 retained surface (sprint-070).
- Retrofitting the rest of the app onto the new toast host.

## Acceptance criteria
- [ ] The matrix exists in the summary and the user has walked it.
- [ ] The cross-surface pass is recorded, with any divergence fixed rather than noted.
- [ ] `packages/web-client/AGENTS.md` and root `AGENTS.md` state what shipped and what did not.
- [ ] `ui-components.md` § Feedback describes the toast host as built, not as specified.
- [ ] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
      `npm test`.
- [ ] The `#ui` mock grammar additions from tasks 006–007 are documented alongside sprint-068's.
- [ ] No temporary toast-firing scaffolding from task-005 remains.

## Test / verification plan
- Full suite: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`, `npm test`.
- Manual: the matrix above, plus one pass with a real `pi` and a real interactive extension to confirm
  the attention signals behave against real timing (a real dialog's arrival and answer, not a scripted
  one).

## Hand-off for visual sign-off (user)
This task **is** the hand-off. Deliver the matrix plus the full `#ui` recipe list, then apply whatever
the pass turns up before closing the sprint.

## Notes
The toast host is app-wide from the moment it lands, even though `notify` is its only caller. Anything
that looks wrong about toasts in general — stacking, placement, Esc precedence against dialogs and
armed question cards — is in scope for this pass, because this sprint is where that primitive entered
the app.
