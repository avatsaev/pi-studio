# Task 002 — `StatusDot` pulse modifier, local to needs-input

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / components/primitives, ui
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
Add an opt-in `.pulse` modifier to the shared `StatusDot`: a box-shadow ring that grows to 4px in
`statusWarning` 55% and fades to transparent on a 1.8s ease-in-out loop, used **only** by needs-input.

## Context / why
§ 08 keeps the pulse from rev 1 but demotes it to "a local modifier, not new `StatusDot` behaviour" —
the shared dot's default is unchanged and no other status gains motion. That distinction is the whole
task: `StatusDot` is used across the sidebar, tab strip and headers, so motion added to its default
path would animate unrelated states.

It is a separate task from task-001 precisely because it touches a shared primitive. Bundled into the
row work, an accidental default-on pulse would ship as a side effect of a sidebar change.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 08 (Pulse: box-shadow ring only,
  nothing moves or resizes, applied on all three surfaces), § 13 (reduced motion → static dot, no
  pulse, on all three attention surfaces)
- `packages/web-client/src/components/primitives/StatusDot.tsx` +
  `StatusDot.module.css` (note the existing `running` variant's ring/arc treatment — the precedent for
  a per-status visual without changing the default)
- `packages/web-client/src/ui/status-dot.ts`

## What to build
- A `pulse` opt-in on `StatusDot` (prop or modifier class), defaulting **off**.
- CSS: box-shadow ring only — grows to 4px, `statusWarning` 55% → transparent, 1.8s ease-in-out,
  infinite. The dot itself must not move, resize, or change layout; the ring must not affect
  surrounding metrics.
- `prefers-reduced-motion: reduce` → static dot, no animation.
- Applied by the needs-input state on all three surfaces (row, collapsed workspace header, tab strip)
  so the same state looks identical everywhere. Nothing else in the app opts in.

## Out of scope
- Any change to `StatusDot`'s default rendering or to another status' appearance.
- The header and tab-strip surfaces themselves (tasks 003–004) — they consume this modifier once they
  exist; wiring the row (task-001) is enough to prove it here.

## Acceptance criteria
- [ ] `StatusDot` without the opt-in renders exactly as it does today (no animation, identical box).
- [ ] The needs-input row dot pulses; a running/idle/error dot elsewhere does not.
- [ ] The ring does not shift or resize adjacent content (no layout jitter while pulsing).
- [ ] With reduced motion enabled the dot is static everywhere.
- [ ] No raw px/hex; the ring colour comes from `statusWarning` via `color-mix`.

## Test / verification plan
- Tests: none meaningful for pure CSS motion (no jsdom). If the opt-in is expressed in logic (e.g. a
  presentation module deciding when to pulse), test that decision.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Raise `#ui select` in a background session: the row dot pulses. Look at any other session's dot in the
same sidebar — no motion. Then enable OS reduced motion and confirm the pulse stops while the dot
stays visible.

## Notes
`StatusDot.module.css` already carries a status-specific treatment (the `running` ring with a rotating
arc), so the file has an established pattern for this; follow it rather than introducing a second
mechanism.
