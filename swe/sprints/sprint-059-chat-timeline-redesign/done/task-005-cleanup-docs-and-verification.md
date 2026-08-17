# Task 005 — Dead-style sweep, shared conventions, spec/docs sync, cross-variant verification

- **Sprint:** sprint-059-chat-timeline-redesign
- **Status:** backlog
- **Type:** chore + docs + test
- **Area:** packages/web-client, swe/features, AGENTS.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004

## Goal

Close the sprint: delete the styles the redesign orphaned, record the two token conventions the
remaining redesign PRs depend on, bring the timeline spec back in line with what the code now does,
and run the design spec's pre-ship verification list.

## Context / why

Tasks 002–004 replace the bubble layout kind by kind, which predictably leaves orphaned rules in
`rows.module.css` and possibly `Timeline.module.css`. Dead CSS in a module file is worse than dead
TS — nothing type-checks it and nothing warns, so it survives indefinitely and misleads the next
reader about which treatment is live.

Two conventions this sprint establishes are load-bearing for the **later** redesign sprints
(sidebar, composer, files panel), and neither is currently written down anywhere:

- `statusSuccess` — not `success` — for green signals, because `success` aliases the accent on dark
  variants (`theme/colors.ts:246`). This is invisible on the default theme and will be re-introduced
  by the next person unless it is documented.
- `accentForeground` — not a hardcoded white — for content on accent fills, because the `zinc`
  variant's accent is near-white.

Finally, `swe/features/timeline-rendering.md` § Row treatments still describes the reference app's
right-aligned bubble design. After this sprint the web client no longer does that, so the spec
actively contradicts the code — exactly the drift the project's own docs rule forbids leaving behind.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (implementation order, VERIFY BEFORE
  SHIPPING, DO NOT), § 02 (token mapping)
- `swe/features/timeline-rendering.md` § Row kinds, § Row treatments, § Tool-call cards
- `packages/web-client/src/features/chat/rows/rows.module.css`
- `packages/web-client/src/features/chat/Timeline.module.css`
- `packages/web-client/AGENTS.md` — Invariants / styling conventions
- `packages/web-client/src/theme/token-integrity.test.ts`, `font-scale.test.ts`
- Modify: the two CSS modules, `swe/features/timeline-rendering.md`, `packages/web-client/AGENTS.md`

## What to build

**1. Dead-style sweep.** Remove every rule orphaned by tasks 002–004 — the bubble fills, `align-self`
rules, notched corners, the `.who` label, the `blink` keyframes and `▍` caret styles, and any tool
header/badge rule the rebuild replaced. Verify by searching for each class name's usages, not by
eye: a class referenced only from a deleted JSX branch still *looks* used inside the CSS file.

**2. Reduced-motion audit.** Confirm every animation this sprint introduced or kept in the timeline
(caret, running spinner, and the retained working-dots indicator) is disabled or held static under
`prefers-reduced-motion: reduce`.

**3. Conventions written down.** Add the `statusSuccess`-not-`success` and
`accentForeground`-not-white rules to `packages/web-client/AGENTS.md`'s invariants, each with the
one-line reason (dark-variant alias; near-white zinc accent). Short entries — they are rules, not an
essay.

**4. Spec sync.** Update `swe/features/timeline-rendering.md` so its row-treatment and tool-card
sections describe the shipped design (rail + meta line, frameless assistant, badge/status/output-strip
card), and reference the handoff spec as the visual source of truth for the web client. Where the
document still describes reference-app behavior the web client deliberately does not implement, say
so explicitly rather than silently rewriting history.

**5. Verification sweep** (§ 07's list) — run it as the sprint's definition of done, recording results
in the task summary:

- `token-integrity.test.ts` + `font-scale.test.ts` green — no dangling or illegal token.
- All six theme variants, with `light` and `zinc` checked deliberately: the `color-mix` fills must
  darken (not lighten) on `light`, and accent-fill content must stay legible on `zinc`.
- Compact form factor (< 576px): rows, badges and the card header still fit; nothing hover-only
  becomes unreachable (`hoverVisible` in `components/primitives/helpers.ts`).
- Long strings: a deep file path and a long shell command — ellipsis, no wrap, no layout shift, no
  horizontal scrollbar.
- A live streaming turn end-to-end: caret → markdown flip, `running` → `completed` card transition,
  rail continuity, autoscroll still sticking to the bottom while streaming.

## Out of scope

- Sidebar, composer/ModelMenu, queue chips, TurnProgressBar, Files panel, pane headers — separate
  sprints per § 07's sequence.
- Removing the working-dots running indicator (belongs with the TurnProgressBar sprint that replaces
  it).
- Adding component-test (jsdom) infrastructure — not this project's convention.
- Rewriting `timeline-rendering.md` wholesale; only the sections this sprint made untrue.

## Acceptance criteria

- [ ] No unused class or keyframe remains in `rows.module.css`/`Timeline.module.css`; each removal
      was confirmed by searching for usages across `packages/web-client/src`.
- [ ] No `▍` glyph, `blink` keyframe, `align-self`, or `max-width: 85%` bubble rule remains in the
      timeline styles.
- [ ] Every timeline animation is neutralized under `prefers-reduced-motion: reduce`.
- [ ] `packages/web-client/AGENTS.md` states both token rules with their reasons.
- [ ] `swe/features/timeline-rendering.md` describes the shipped rows; no section still claims the
      web client renders right-aligned user bubbles or a bordered assistant card.
- [ ] `npm test` (full suite) and `npm run typecheck` pass; `npm run lint` and `npm run fmt:check`
      are clean.
- [ ] The § 07 verification list is executed and its results recorded in the task summary — including
      the `light` and `zinc` checks and the compact-width check, each stated as observed, not assumed.

## Test / verification plan

- Build: `npm run build` (full, dependency-ordered) succeeds.
- Typecheck: `npm run typecheck` succeeds. If a signature changed earlier in the sprint, run
  `npm run clean` first — stale `.tsbuildinfo` files make incremental typecheck silently miss errors.
- Lint/format: `npm run lint` and `npm run fmt:check` clean (scoped `npx oxfmt <files>` to fix; never
  a project-wide reformat).
- Tests: `npm test` — full suite green.
- Manual: `npm run dev:daemon` + web client for the variant/width/long-string matrix, then a real Pi
  session for the live streaming pass.

## Notes

- The docs rule in the repo's root `AGENTS.md` applies to this sprint's code as a whole: this task is
  where that debt is settled, not a follow-up.
- If the sweep finds a rule that is orphaned but *not* from this sprint, leave it and note it — an
  unrelated cleanup inflates the diff and hides the redesign.
- Keep the design HTML as the single visual source of truth; do not fork a second markdown copy of
  the mock into `swe/features/` that will immediately drift.
