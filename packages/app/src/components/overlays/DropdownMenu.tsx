/**
 * DropdownMenu — compound component built on @radix-ui/react-dropdown-menu.
 * Themed surfaces; dismiss on outside-click + Esc.
 * ui-components.md § Overlays — DropdownMenu
 */

import { type ReactNode } from "react";
import * as Radix from "@radix-ui/react-dropdown-menu";
import { clsx } from "clsx";
import styles from "./DropdownMenu.module.css";

// Re-export Radix primitives as themed wrappers.
export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;

export function DropdownMenuContent({
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  className,
}: {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        className={clsx(styles.content, className)}
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  selected,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
  className?: string;
}) {
  return (
    <Radix.Item
      className={clsx(
        styles.item,
        destructive && styles.itemDestructive,
        selected && styles.itemSelected,
        className,
      )}
      onSelect={onSelect}
      disabled={disabled}
    >
      {children}
    </Radix.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <Radix.Label className={styles.label}>{children}</Radix.Label>;
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className={styles.separator} />;
}
