/**
 * PaneDividers — the draggable boundaries between panes, rendered as an absolutely-positioned
 * overlay inside `TabPanelHost`'s area.
 *
 * An overlay, not a layout participant: a divider that consumed layout space would shift the panes
 * away from the rects `paneRects` computed for them, and panels (positioned from the same rects)
 * would drift out of alignment with their strips. So each handle is centred *on* the boundary with a
 * few px of hit area either side, and takes no space.
 *
 * Dragging is delta-based, exactly like `ResizeHandle` (sidebar widths): each `pointermove` reports
 * the movement since the previous one and converts it with the split's own extent — `sizes` are
 * fractions of the split, not of the host, so a nested divider's px→fraction denominator is
 * `splitRect`'s extent × the host's (`pane-tree.ts`'s `Divider.splitRect`). Absolute
 * pointer-to-fraction math would need the sizes captured at drag start and drift against the store's
 * clamping; deltas simply cannot.
 *
 * swe/features/workspace-split-panes.md § Resizing
 */

import { useRef } from "react";
import { clsx } from "clsx";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import type { Divider } from "./pane-tree.js";
import styles from "./PaneDividers.module.css";

export interface PaneDividersProps {
  cwd: string;
  dividers: readonly Divider[];
  /** The host content box, measured at drag start — the px→fraction denominator. */
  hostRef: React.RefObject<HTMLDivElement | null>;
}

export function PaneDividers({ cwd, dividers, hostRef }: PaneDividersProps) {
  const resizeDivider = useLayoutStore((s) => s.resizeDivider);
  const lastRef = useRef(0);

  function startDrag(ev: React.PointerEvent<HTMLDivElement>, divider: Divider): void {
    const host = hostRef.current?.getBoundingClientRect();
    if (!host) return;
    ev.preventDefault();
    ev.stopPropagation(); // dragging a boundary is not a click into either pane

    const horizontal = divider.direction === "row";
    const extentPx = horizontal
      ? divider.splitRect.width * host.width
      : divider.splitRect.height * host.height;
    if (extentPx <= 0) return;

    lastRef.current = horizontal ? ev.clientX : ev.clientY;
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (move: PointerEvent): void => {
      const position = horizontal ? move.clientX : move.clientY;
      const deltaPx = position - lastRef.current;
      lastRef.current = position;
      resizeDivider(cwd, divider.splitPath, divider.boundaryIndex, deltaPx / extentPx);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return dividers.map((divider) => {
    const horizontal = divider.direction === "row";
    return (
      <div
        key={`${divider.splitPath.join(".")}:${divider.boundaryIndex}`}
        className={clsx(styles.divider, horizontal ? styles.vertical : styles.horizontal)}
        style={
          horizontal
            ? {
                left: `${divider.rect.x * 100}%`,
                top: `${divider.rect.y * 100}%`,
                height: `${divider.rect.height * 100}%`,
              }
            : {
                left: `${divider.rect.x * 100}%`,
                top: `${divider.rect.y * 100}%`,
                width: `${divider.rect.width * 100}%`,
              }
        }
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        onPointerDown={(ev) => startDrag(ev, divider)}
      />
    );
  });
}
