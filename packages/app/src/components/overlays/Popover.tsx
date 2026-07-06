/**
 * Popover — built on @radix-ui/react-popover.
 * ui-components.md § Overlays
 */

import { type ReactNode } from "react";
import * as Radix from "@radix-ui/react-popover";
import styles from "./DropdownMenu.module.css"; // reuse same surface styles

export const Popover = Radix.Root;
export const PopoverTrigger = Radix.Trigger;
export const PopoverAnchor = Radix.Anchor;

export function PopoverContent({
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  maxWidth = 320,
  className,
}: {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  maxWidth?: number;
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        className={`${styles.content}${className ? ` ${className}` : ""}`}
        style={{ maxWidth }}
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}
