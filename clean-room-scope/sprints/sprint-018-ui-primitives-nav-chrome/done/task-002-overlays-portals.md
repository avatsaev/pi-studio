# Task 002 — Overlay, portal & feedback infrastructure

- **Sprint:** sprint-018-ui-primitives-nav-chrome
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-012/task-002,004 (overlay/portal + feedback contracts)

## Goal
Provide the DOM overlay/portal layer that Paseo builds with floating-ui + gorhom: popovers, tooltips,
dropdown menus, modals/dialogs, a bottom-sheet-equivalent, a portal host, and the toast/download-toast
feedback surfaces.

## Scope references
- `clean-room-scope/features/ui-components.md` § overlays, § feedback
- `clean-room-scope/architecture/design-system.md` § overlay/portal infrastructure

## What to build
- `Popover`/`Tooltip`/`DropdownMenu`/`ContextMenu` built on `@floating-ui/react` (or the matching
  `@radix-ui/react-*` primitive) with themed surfaces, arrow/placement, dismiss-on-outside/esc.
- `Modal`/`Dialog` (focus trap, backdrop, esc, scroll-lock) and an `AdaptiveSheet` that renders as a
  centered dialog on wide and a bottom sheet on compact (mirror Paseo's adaptive-modal-sheet).
- A `FloatingPanelPortalHost` + `PortalProvider` mount and the `useOverlay()` open/close registry
  (consume sprint-012 overlay view model).
- `Toast`/`ToastHost` and `DownloadToast` wired to the toast context from sprint-017/task-003.

## Out of scope
- Nav chrome (task-003). Command center palette body (task-003). Screen content.

## Acceptance criteria
- [ ] Popover/tooltip/menu position via floating-ui, dismiss on outside-click + Esc, and are themed.
- [ ] AdaptiveSheet is a dialog on wide and a bottom sheet on compact; focus trap + scroll-lock work.
- [ ] Toasts enqueue/dismiss/auto-expire through the toast context.

## Test / verification plan
- Tests (jsdom + Testing Library): open/close + esc/outside-dismiss; adaptive breakpoint switch;
  toast queue lifecycle (reuse sprint-012 feedback model).

## Notes
- Overlays are the substrate for tab context menus, git-action menus, command center, and dialogs later.
