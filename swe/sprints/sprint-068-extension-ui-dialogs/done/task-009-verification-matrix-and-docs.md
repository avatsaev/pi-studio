# Task 009 — Verification matrix, real-Pi pass, spec corrections, docs

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** done
- **Type:** docs
- **Area:** web-client / docs, swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008

## Goal
Close the sprint: one consolidated visual matrix for the user to sign off, a real-`pi` pass with a
real extension, the four spec corrections found during planning, and docs brought in line.

## Context / why
Visual sign-off for this sprint belongs to the user (user direction, 2026-08-21), so the sprint's
final gate is a single ordered checklist rather than per-task claims scattered across summaries. The
mock provider covers the full state matrix; a real extension covers payload fidelity. Both are worth
one deliberate pass at the end, because the last three tasks each changed how earlier states render.

Four documentation defects were identified during planning and deliberately deferred to here so they
land once, together, rather than being re-litigated per task.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` — all sections (the visual
  authority for the matrix)
- `swe/features/extension-ui-client-sdk.md` § Acceptance criteria
- `packages/web-client/AGENTS.md`, root `AGENTS.md`, `swe/sprints/PLAN.md`
- `packages/cli/src/agent-ui-sdk-e2e.test.ts` (sprint-067's harness; the real-Pi smoke precedent)

## What to build
- **Verification matrix** — a single checklist in the task summary, ordered so the user can walk it
  top to bottom in one session, covering: each dialog kind, the unrecognised card, empty options, the
  stacking and scrolling thresholds, multi-line prompts, deadline present/absent, in-flight, resolved
  (each outcome), non-answerable/reconnect, multi-card ordering, recovered markers, the collapse
  counter, and the full keyboard set including the no-card-pending regression checks. Each row names
  the exact recipe from task-001 and the expected result.
- **Real-`pi` pass** — one run against a real `pi` with `@juicesharp/rpiv-ask-user-question`
  (sprint-067/task-004 proved it produces a real `select`/`input` pair). This is the fidelity check
  the mock cannot give: its options are self-numbered and past the stacking threshold, and its
  `input` title carries embedded newlines and a bracketed prefix — the exact payloads § 03's rules
  were derived from. Record what the cards actually looked like.
- **Spec corrections** — file these against the visual spec (they are documentation defects found
  while planning, not implementation choices):
  1. § 08's self-contradiction: the section banner says no row tint for needs-input while its own
     `Row fill` entry specifies a 10% wash, and § 01 explicitly disclaims a session-row tint. Must be
     resolved before sprint-069 implements the sidebar; flag it now rather than at that sprint's
     planning.
  2. § 01's palette table no longer lists every value the document uses (the row wash, the pulse
     ring's opacity, and `accentBright` from § 11 are all absent) — implementers build the token set
     from that table.
  3. Two wrong cross-references: § 02's control-block wrapping cites § 09 (setWidget) and § 03's
     five-or-more-options rule cites § 13 (motion); both mean § 12.
  4. § 00's wire table gives `editor` a `timeout?` field. Pi's editor payload is `title` + `prefill`
     only, and `editor` is the one dialog with no timeout support, so a deadline bar on an editor card
     is unreachable. (This error originated in the planning brief, not the design.)
- **Docs** — `packages/web-client/AGENTS.md`: the new `features/agent-ui/` module (its pure modules,
  the store's controller-per-client lifecycle, the capability gate, and the deliberate non-handling of
  effects this sprint). Root `AGENTS.md`: extend the `agent_ui_*` protocol paragraph to say the
  browser now renders dialogs, and state plainly what still does not render (surfaces, transients,
  attention badging) so the entry does not imply coverage that has not shipped. `PLAN.md`: mark the
  sprint and update the coverage paragraph for `features/extension-ui-client-sdk.md`.

## Out of scope
- Implementing any § 08/§ 09/§ 10/§ 11 surface — corrections are filed, not built.
- Editing the visual spec HTML directly (it is the designer's artifact); report the corrections.

## Acceptance criteria
- [x] The matrix exists in the summary, every row naming a recipe and an expected result, and the
      user has walked it.
- [x] The real-`pi` pass is recorded, including how the live payloads actually rendered. It found a
      card-ordering bug (cards appended after every row instead of placed chronologically), now
      fixed via `ask-placement.ts` and re-verified — see the summary.
- [x] All four spec corrections are filed where the designer will see them.
- [x] `packages/web-client/AGENTS.md` and root `AGENTS.md` describe what shipped and, explicitly, what
      did not.
- [x] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
      `npm test`.
- [x] No stray dev scaffolding: task-001's trigger is intentional and documented; anything else added
      for debugging is gone.

## Test / verification plan
- Full suite: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`, `npm test` —
  all green, no skipped tests introduced by this sprint.
- Manual: the matrix above, plus the real-`pi` pass.

## Hand-off for visual sign-off (user)
This task **is** the hand-off. Deliver the matrix and the trigger recipes together, then apply any
corrections the user's pass turns up before the sprint closes.

## Notes
If the user's pass finds a divergence from the spec that is a genuine design question rather than a
bug (the spec is the visual authority, so most divergences are bugs), record it as a question for the
designer instead of silently choosing an interpretation.
