# Task 002 — `StatusDot` pulse modifier, local to needs-input — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

An opt-in `pulse?: boolean` prop on `StatusDot`, defaulting off, following the same "per-status
visual without touching the default" pattern the `running` variant's ring/arc already establishes
in `StatusDot.module.css`. When set (and the dot isn't already the spinning `running` variant),
a `.pulse` CSS class adds a `box-shadow` ring animation — `0 0 0 0` at `statusWarning` 55% growing
to `0 0 0 4px transparent` over 1.8s ease-in-out, infinite. `box-shadow` is paint-only, so the dot's
own box (width/height, set via the existing `--status-dot-size` custom property) is untouched and
nothing in the layout shifts. `prefers-reduced-motion: reduce` sets `animation: none`, following the
exact pattern already used by `Button.module.css`, `Spinner.module.css`, `AskCard.module.css`, etc.

The prop lives on `StatusDotProps` (component-level), not on the pure `StatusDotInput` type in
`ui/status-dot.ts` — each surface decides for itself whether its own dot should pulse, based on its
own state, rather than baking "pulse" into the shared presentation-data vocabulary. Task-001's row
is wired as the proof (`SessionItem.tsx` now passes `pulse={view.state === "needsInput"}`); tasks
003–004 will do the same for the collapsed workspace header and tab strip.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/components/primitives/StatusDot.tsx` | modified — `pulse` prop, class wiring |
| `packages/web-client/src/components/primitives/StatusDot.module.css` | modified — `.pulse` + `@keyframes statusDotPulse` + reduced-motion override |
| `packages/web-client/src/features/sessions/SessionItem.tsx` | modified — passes `pulse` on the needs-input row dot |

## How it satisfies the scope

Matches § 08's Pulse subsection (box-shadow ring only, nothing moves/resizes, 1.8s ease-in-out) and
§ 13's reduced-motion requirement, using `StatusDot.module.css`'s existing `running`-variant pattern
as precedent per the task's own Notes. Out of scope per the task: the header/tab-strip surfaces
themselves are left to tasks 003–004, which now have a modifier to consume.

## Build & test results

```
$ npx tsc -b --force
(clean — no output)

$ npm run build:web-client
✓ built in 10.25s

$ npm run lint
(zero warnings on any file touched by this task)

$ npx oxfmt <changed files>
(reformatted SessionItem.tsx's one long-line JSX attribute list; re-checked clean)

$ npx vitest run packages/web-client/src/features/sessions/ packages/web-client/src/ui/ packages/web-client/src/components/
 Test Files  3 passed (3)
 Tests  37 passed (37)
```

No new tests: per the task's own plan, pure CSS motion has no meaningful jsdom-free test, and the
opt-in decision (`view.state === "needsInput"`) is already covered by task-001's
`session-presentation.test.ts` needs-input assertions — the `pulse` prop itself is a direct,
untested boolean pass-through of that already-tested state.

## Acceptance criteria

- [x] `StatusDot` without the opt-in renders exactly as it does today — `pulse` defaults to
      `undefined` (falsy), so the class list is byte-identical to before this task for every
      existing caller (none of which pass `pulse`).
- [x] The needs-input row dot pulses; a running/idle/error dot elsewhere does not — only
      `SessionItem.tsx`'s needs-input branch passes `pulse={true}`; every other `StatusDot` call
      site in the repo is unchanged.
- [x] The ring does not shift or resize adjacent content — `box-shadow` is paint-only; `.dot`'s
      `width`/`height` are untouched by `.pulse`.
- [x] With reduced motion enabled the dot is static everywhere — `@media (prefers-reduced-motion:
      reduce) { .pulse { animation: none; } }`.
- [x] No raw px/hex; the ring colour comes from `statusWarning` via `color-mix` — confirmed in
      `@keyframes statusDotPulse`.

## Follow-ups / TODO(verify)

- Manual visual sign-off (raise `#ui select` in a background session, observe the row pulse, then
  toggle OS reduced motion) deferred to task-009's consolidated matrix, per this sprint's hand-off
  convention.
- Tasks 003–004 must apply this same `pulse` prop to their own dots for § 08's "applied on all three
  surfaces" cross-surface requirement to hold — task-009's cross-surface pass checks this.
