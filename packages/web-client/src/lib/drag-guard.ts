/**
 * `drag-guard` — takes cross-document children out of hit-testing for the duration of a drag.
 *
 * An `<iframe>` is a separate document that hit-tests on its own. While the cursor is over one, the
 * *parent* document receives neither `pointermove` (dnd-kit's sensor listens on the owner document
 * — its bundle contains no `setPointerCapture` at all) nor `dragover`/`drop` (native HTML5 DnD
 * dispatches into the frame's own document). So a tab or a sidebar file dragged over `HtmlViewer`'s
 * preview loses its drop preview and cannot be dropped: the pane beneath the iframe is unreachable
 * even though it is the obvious target.
 *
 * `PaneDividers`/`ResizeHandle` fix their version of this with `setPointerCapture`, which redirects
 * a single pointer's events to the handle that owns the gesture. That mechanism is unavailable
 * here — dnd-kit owns the pointer gesture for a tab drag, and native drag-and-drop has no
 * pointer-capture concept whatsoever. Removing the frame from hit-testing is the one mechanism that
 * covers both systems.
 *
 * Implemented as an attribute on `<body>` plus a CSS rule, deliberately *not* as React state:
 * arming it costs no re-render mid-gesture, and it never touches the iframe's `srcDoc` — a re-set
 * `srcDoc` reloads the previewed document and re-runs its scripts (`HtmlViewer`'s single-load
 * rule). It is also viewer-agnostic: any future embedded frame is covered without new wiring.
 *
 * The paired rule lives in `global.css`. `drag-guard.test.ts` fails the build if the attribute here
 * and the selector there ever drift apart.
 */

/** Set on `<body>` while any drag gesture is in flight. Mirrored by `global.css`'s guard rule. */
export const DRAG_GUARD_ATTR = "data-pi-dragging";

/** The slice of `Element` this module touches — keeps it drivable without a DOM in tests. */
export interface DragGuardTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Arm the guard. Idempotent: the two drag systems are mutually exclusive (`TabPanelHost`), but a
 * gesture that ends in `dragend` *and* `drop` must not leave the guard half-released.
 */
export function armDragGuard(target: DragGuardTarget = document.body): void {
  target.setAttribute(DRAG_GUARD_ATTR, "");
}

/** Disarm the guard. Idempotent, for the same reason. */
export function disarmDragGuard(target: DragGuardTarget = document.body): void {
  target.removeAttribute(DRAG_GUARD_ATTR);
}
