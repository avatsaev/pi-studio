# Task 002 — Animations, transitions & motion design

- **Sprint:** sprint-028-polish-a11y
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Add tasteful animations and transitions across the app using framer-motion and CSS transitions
for a polished, responsive feel.

## Scope references
- `swe/architecture/design-system.md` § motion, § transitions

## What to build
- **Page transitions**: cross-fade between route changes (150ms). Workspace → workspace: slide.
  Settings nested routes: slide from right.
- **Sidebar**: slide in/out with spring physics (framer-motion `AnimatePresence`). Overlay mode:
  fade + slide; pinned mode: instant.
- **Toast notifications**: slide in from bottom-right; auto-dismiss with progress bar; swipe to
  dismiss (framer-motion drag).
- **Dialog/sheet**: fade-in backdrop + scale-up content (100ms). Bottom sheet: slide up with
  spring. Dismiss: reverse animation.
- **Tab transitions**: cross-fade pane content on tab switch (100ms). New tab: expand from center.
  Close tab: shrink + fade.
- **List items**: stagger-in for session list, schedule list (50ms per item). New items: fade-in
  at position.
- **Tooltip**: fade-in with 50ms delay; position transition on content change.
- **Reduced motion**: respect `prefers-reduced-motion` media query — disable all animations,
  use instant transitions. Expose toggle in settings.
- **Performance**: use `will-change` judiciously; prefer `transform`/`opacity` animations over
  layout-triggering properties. GPU-accelerated where possible.

## Acceptance criteria
- [ ] Route changes animate smoothly; no flash of unstyled content.
- [ ] Sidebar/dialog/sheet/toast have appropriate entrance/exit animations.
- [ ] `prefers-reduced-motion` disables all animations.
- [ ] No jank (60fps) during animations on mid-range hardware.

## Test / verification plan
- Visual: test each animation type in browser; verify timing feels right.
- Reduced motion: set media query → verify no animations.
- Performance: run Chrome DevTools Performance panel during animations → verify 60fps.
