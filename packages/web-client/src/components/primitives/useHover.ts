/**
 * useHover — pointer-enter/leave hover tracking for web.
 * design-system.md § Hover-to-show
 * Raw pointer events only used inside this hook (web-safe; never a layout signal).
 */

import { useState, useCallback, type RefObject } from "react";
import { hoverVisible } from "./helpers.js";

export interface UseHoverReturn {
  isHovered: boolean;
  hoverProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
  /** True when the control should be visible per hover-to-show rule. */
  isVisible: (isCompact?: boolean) => boolean;
}

export function useHover(): UseHoverReturn {
  const [isHovered, setIsHovered] = useState(false);

  const onPointerEnter = useCallback(() => setIsHovered(true), []);
  const onPointerLeave = useCallback(() => setIsHovered(false), []);

  const isVisible = useCallback(
    (isCompact = false) => hoverVisible(isHovered, false, isCompact),
    [isHovered],
  );

  return {
    isHovered,
    hoverProps: { onPointerEnter, onPointerLeave },
    isVisible,
  };
}
