# Task 004 — Overlays, navigation chrome, feedback primitives

- **Sprint:** sprint-012-ui-foundation
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-003

## Goal
Implement the overlay family, the shared header/sidebar chrome, and the feedback primitives.

## Scope references
- `clean-room-scope/features/ui-components.md` § Overlays, § Navigation chrome, § Feedback,
  § Status dots & avatars, § Scroll & dividers

## What to build
- **Overlays:** floating surface + floating scroll view (geometry seam); `Tooltip` (desktop hover /
  keyboard-focus, compact press; portal on web); `DropdownMenu` (+ trigger/content/item/label/separator/
  hint; item status idle|pending|success, selected/destructive/tooltip; iOS deferred select); `ContextMenu`
  (pointer/long-press anchor; compact sheet mode); `AdaptiveModalSheet` (desktop centered card + overlay-
  root portal + Esc-to-close; compact bottom sheet; structured header/footer/search/drop); the autocomplete
  popover (anchored above a composer input).
- **Navigation chrome:** `ScreenHeader` frame (surface0, border, height 56/48, safe-area + window-control
  padding, left/right slots, titlebar drag region) + menu header / back header / header icon badge /
  screen title variants; sidebar surfaces + separator; the split container + drop zone + resize handle
  (web pane layout).
- **Feedback:** toast host + viewport (variants, durations, hover-pause, overlay-root portal on web);
  spinner + synced loader; pulsing skeleton; the agent status dot (state-bucket → color); error/quitting
  boundaries.
- **Scroll/dividers:** floating scroll view, web custom-scrollbar overlay + platform style hook, divider.

## Out of scope
- Wiring overlays into specific screens (sprints 014–017).

## Acceptance criteria
- [ ] Dropdown/context-menu/tooltip share one flip/align/clamp routine and reroute to bottom sheets on
      compact; the modal sheet is a centered card on desktop (Esc + overlay-root) and a bottom sheet on
      compact.
- [ ] Headers share one frame across menu/back/title variants with correct height + window-control padding.
- [ ] Toasts portal into the overlay root on web and pause the dismiss timer on hover; skeleton + status
      dot render per the catalog.

## Test / verification plan
- Tests: positioning reuse (flip/clamp); toast api (`copied`/`error`/sticky) + timer pause; status-dot
  bucket→color; Esc-stack top-of-stack close.

## Notes
- Verify whether a shared empty-state/card/divider primitive exists or stays per-feature composition.
