/**
 * ResizeHandle — thin draggable strip for resizing an adjacent sidebar (`WorkspacePage`'s
 * `sidebarLeft`/`sidebarRight`). Pointer-driven: `pointerdown` starts a drag, `pointermove`
 * reports the raw pixel delta since the last move, `pointerup` ends it. Width clamping and
 * persistence live in the caller (`ui-store.ts`'s `setLeftSidebarWidth`/`setRightSidebarWidth`) —
 * this component only ever reports deltas, never owns or reads the width itself.
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
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      (ev.target as HTMLElement | null)?.releasePointerCapture?.(ev.pointerId);
    },
    [handlePointerMove],
  );

  function handlePointerDown(ev: React.PointerEvent<HTMLDivElement>): void {
    ev.preventDefault();
    startXRef.current = ev.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div
      className={clsx(styles.handle, className)}
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
