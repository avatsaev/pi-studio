/**
 * Popover — shared chrome for Radix `Popover` surfaces: anchored, non-modal panels that host
 * interactive content such as a text field. A `DropdownMenu` is the wrong primitive for those (its
 * typeahead and roving focus fight text input), so `Menu.tsx`'s sibling here wraps
 * `@radix-ui/react-popover` the same way: `Root`/`Trigger` need no shared styling and are plain
 * passthroughs; only the portal + surface is wrapped, with the `Menu` surface tokens.
 * ui-components.md § Overlays
 */

import type { ComponentPropsWithoutRef } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { clsx } from "clsx";
import styles from "./Popover.module.css";

export const Popover = {
  Root: RadixPopover.Root,
  Trigger: RadixPopover.Trigger,
  Anchor: RadixPopover.Anchor,
  Close: RadixPopover.Close,
};

export interface PopoverContentProps extends ComponentPropsWithoutRef<typeof RadixPopover.Content> {
  /** Surface width in px; the panel is otherwise sized by its content. */
  width?: number;
}

/** Portaled popover surface. Defaults: below the trigger, `align="start"`, 6px offset, and an
 * 8px collision padding so it never touches the viewport edge. Radix returns focus to the trigger
 * on close and dismisses on Escape/outside press by default. */
export function PopoverContent({
  className,
  width,
  style,
  side = "top",
  align = "start",
  sideOffset = 6,
  collisionPadding = 8,
  ...rest
}: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        className={clsx(styles.content, className)}
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={width === undefined ? style : { width, ...style }}
        {...rest}
      />
    </RadixPopover.Portal>
  );
}
