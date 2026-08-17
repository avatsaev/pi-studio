# Task 003 — Docs sync + cross-variant / reduced-motion / a11y verification sweep

- **Sprint:** sprint-060-turn-progress-bar
- **Status:** done
- **Type:** docs + test
- **Area:** packages/web-client, swe/features
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Close the sprint: record the new component and the one-indicator-per-pane rule in the web client's
docs, correct the timeline scope doc where it still describes a running **footer** this client no
longer renders, and run § 07's pre-ship checks against the bar.

## Context / why

Two documents now contradict the code:

- `packages/web-client/AGENTS.md:296-299`'s source-layout tree lists `chat/` as
  "ChatPanel, Timeline, Composer …" — `TurnProgressBar` is missing, and the repo's docs rule makes
  that this sprint's debt, not a follow-up.
- `swe/features/timeline-rendering.md:164` specifies a **"Running footer: a spinner (amber) + a live
  elapsed timer (ticks ~10×/s)"**, echoed by the acceptance line at `:236-237`. That describes the
  reference app. This client never built the elapsed timer, built dots instead, and now renders a
  top-mounted indeterminate bar — so the section must say what the client actually does and mark the
  reference-app behavior as deliberately not implemented (the same treatment `composer-ui.md:75-82`
  already uses for the queue-track vs. steering divergence, which is the house pattern for this).

The reduced-motion block introduced by task 001 is also the codebase's **first**, which makes it a
convention worth one line rather than folklore rediscovered by the next animated component.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 05, § 07 (VERIFY BEFORE SHIPPING)
- `packages/web-client/AGENTS.md:295-299` (source layout, `chat/` line) + its Invariants section
- `swe/features/timeline-rendering.md:162-166` (turn timing / running footer / completed footer),
  `:236-237` (acceptance line naming the elapsed timer)
- `swe/features/composer-ui.md:75-82` — the established "web client deliberately diverges" wording
- `packages/web-client/src/theme/token-integrity.test.ts`, `font-scale.test.ts`
- Modify: `packages/web-client/AGENTS.md`, `swe/features/timeline-rendering.md`

## What to build

**1. `packages/web-client/AGENTS.md`.** Add `TurnProgressBar` to the `chat/` source-layout line, and
one Invariants entry covering the three decisions a future reader would otherwise re-litigate:
the running affordance is **one indeterminate bar per pane, mounted absolutely at the top of
`ChatPanel`** (absolute so mount/unmount never reflows the virtualized timeline or disturbs
stick-to-bottom autoscroll); its trigger is `session.status === "running"`, which is what makes a
mid-turn page reload show it (hydrated daemon status) rather than waiting for a `turn_started`; and
every new animation carries a `prefers-reduced-motion: reduce` override in its own module. Short
entries — rules with a reason, not an essay.

**2. `swe/features/timeline-rendering.md`.** Rewrite the running-footer bullet (and reconcile the
acceptance line) so it states the shipped behavior — a top-mounted indeterminate progress bar for the
duration of the turn — and says plainly that the reference app's amber spinner + live elapsed timer
and the "Worked for <duration>" completed footer are **not** implemented here, rather than silently
deleting the paragraph. Reference `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 05 as
the visual source of truth for the web client's indicator.

**3. Verification sweep**, recorded in the task summary as observed results, not assumptions:

- `token-integrity.test.ts` + `font-scale.test.ts` green.
- `dark`, `light` and `zinc` variants: the 22% track and the gradient must read as a tinted rule on
  all three — on `light` the `color-mix` darkens rather than lightens, and `zinc`'s near-white accent
  makes the sweep low-contrast against `surface0`; if either fails, that is a real finding to report,
  not to silently retune away from the spec's ratios.
- Compact form factor (< 576px): the bar still spans the pane and clips nothing.
- Reduced motion: static, full-width, 50% opacity, no animation.
- Accessibility tree: the running state is exposed by name; the sweep is not read as content.
- One live streaming turn end-to-end: bar mounts on turn start, survives tool calls and reasoning
  gaps, unmounts on completion; a second run interrupted mid-turn unmounts on cancel; autoscroll stays
  pinned throughout.

## Out of scope

- Queue chips, the composer/`ModelMenu` move, `StatusBar`'s model chip (§ 05's other half), and § 06's
  files panel / pane headers — separate sprints.
- `swe/features/timeline-rendering.md`'s row-treatment and tool-card sections —
  `sprint-059/task-005` owns those. Touch only the running/completed-footer material.
- Rewriting `timeline-rendering.md` wholesale, or forking a markdown copy of the design mock.
- Adding component-test (jsdom) infrastructure.

## Acceptance criteria

- [ ] `packages/web-client/AGENTS.md` lists `TurnProgressBar` in the `chat/` layout line and states
      the mount/trigger/reduced-motion rules with their reasons.
- [ ] `swe/features/timeline-rendering.md` no longer claims this client renders a running footer with
      a live elapsed timer; it describes the top-mounted bar and explicitly marks the reference-app
      footer behavior as not implemented.
- [ ] No doc anywhere still describes the "Agent is working…" dots.
- [ ] `npm test` (full suite) and `npm run typecheck` pass; `npm run lint` and `npm run fmt:check`
      are clean.
- [ ] The § 07 verification list above is executed and each item's result recorded in the task
      summary — including the `light`/`zinc` reads, the compact width, and the reduced-motion and
      accessibility-tree checks, each stated as observed.

## Test / verification plan

- Build: `npm run build` (full, dependency-ordered) succeeds.
- Typecheck: `npm run typecheck` succeeds; `npm run clean` first if anything earlier in the sprint
  changed a signature.
- Lint/format: `npm run lint`, `npm run fmt:check` clean (scoped `npx oxfmt <files>` to fix — never a
  project-wide reformat).
- Tests: `npm test` — full suite green.
- Manual: `npm run dev:daemon` + web client for the variant/width/reduced-motion matrix, then a real
  Pi session for the live streaming pass.

## Notes
- **Sprint-059 seam.** That sprint's task-005 edits both of the same two documents. Different
  sections (its: row treatments + tool cards + the two token rules; this one: the running footer and
  the animation/mount rules), so whichever lands second re-reads and appends rather than reflowing
  the other's text.
- If the `zinc` variant genuinely reads badly, report it with a screenshot and a proposed ratio rather
  than deviating from § 05 unilaterally — the ratios are shared with the other five redesign PRs.
