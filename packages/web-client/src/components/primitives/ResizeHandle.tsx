/**
 * ResizeHandle — thin draggable strip for resizing an adjacent sidebar (`WorkspacePage`'s
 * `sidebarLeft`/`sidebarRight`). Pointer-driven: `pointerdown` starts a drag, `pointermove`
 * reports the raw pixel delta since the last move, `pointerup` ends it. Width clamping and
 * persistence live in the caller (`ui-store.ts`'s `setLeftSidebarWidth`/`setRightSidebarWidth`) —
 * this component only ever reports deltas, never owns or reads the width itself.
 *
 * The drag explicitly captures its pointer to the handle so it survives the cursor crossing a
 * cross-document child (`HtmlViewer`'s preview iframe) — see `handlePointerDown`.
 */

import { useCallback, useRef } from "react";
import { clsx } from "clsx";
import styles from "./ResizeHandle.module.css";

export interface ResizeHandleProps {
  /** Which sidebar this handle resizes. Left sidebar grows when dragged right (positive delta);
   * right sidebar shrinks when dragged right (its left edge moves right into the panel) — `side`
   * picks the correct sign so the caller only ever adds the raw delta to its current width. */
  side: "left" | "right";
  onResize(deltaX: number): void;
  className?: string;
}

export function ResizeHandle({ side, onResize, className }: ResizeHandleProps) {
  const startXRef = useRef(0);
  const handleRef = useRef<HTMLDivElement | null>(null);

  const handlePointerMove = useCallback(
    (ev: PointerEvent) => {
      const raw = ev.clientX - startXRef.current;
      startXRef.current = ev.clientX;
      onResize(side === "left" ? raw : -raw);
    },
    [onResize, side],
  );

  const handlePointerUp = useCallback(
    (ev: PointerEvent) => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const handle = handleRef.current;
      if (handle?.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    },
    [handlePointerMove],
  );

  function handlePointerDown(ev: React.PointerEvent<HTMLDivElement>): void {
    ev.preventDefault();
    startXRef.current = ev.clientX;
    // Route the whole gesture to this handle rather than to whatever is under the cursor. An
    // iframe (the HTML preview) is its own document and hit-tests `pointermove`/`pointerup`
    // itself, so without capture the window listeners below go silent as soon as the cursor
    // crosses into it and the drag sticks — `pointerup` never arrives either, so it never ends.
    // Chrome grants implicit capture for touch only, never for mouse.
    ev.currentTarget.setPointerCapture(ev.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  return (
    <div
      ref={handleRef}
      className={clsx(styles.handle, className)}
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
