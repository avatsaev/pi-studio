/**
 * Menu — shared chrome for every Radix `DropdownMenu` popup in the app (file/session/workspace
 * right-click context menus, TabStrip's "+" menu, ModelMenu's picker). `DropdownMenu.Root` and
 * `.Trigger` need no shared styling and stay imported directly from `@radix-ui/react-dropdown-menu`
 * at each call site; this only wraps the pieces that were previously four (or more) byte-identical
 * CSS Modules: the invisible cursor-anchored trigger button used by every right-click menu, the
 * popover surface, the row, the separator, and the labelled section header for grouped pickers
 * (`MenuGroup`, whose data half is `ui/option-groups.ts`).
 * ui-components.md § Menus & popovers
 */

import { forwardRef, useId, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { clsx } from "clsx";
import styles from "./Menu.module.css";

export interface MenuCursorTriggerProps {
  /** Viewport coordinates (from the triggering `contextmenu`/click event) to anchor the popup at. */
  x: number;
  y: number;
}

/** Invisible 1x1 trigger positioned at cursor coordinates — the shared shape behind every
 * right-click context menu: `DropdownMenu.Trigger asChild` wraps this so Radix anchors its
 * popover at the click point instead of at a visible element. */
export const MenuCursorTrigger = forwardRef<HTMLButtonElement, MenuCursorTriggerProps>(
  function MenuCursorTrigger({ x, y }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={styles.trigger}
        style={{ left: x, top: y }}
        aria-hidden
        tabIndex={-1}
      />
    );
  },
);

export interface MenuContentProps extends ComponentPropsWithoutRef<typeof DropdownMenu.Content> {
  /** Popover min-width — right-click menus default to a narrow 140-160px; wider pickers (e.g.
   * ModelMenu) override. */
  minWidth?: number;
}

/** Popover surface (background/border/radius/shadow) + Radix portal, `align="start"` and a
 * `sideOffset` of 2 to match the tight right-click-menu default; callers with a visible,
 * button-style trigger (TabStrip's "+" menu, ModelMenu) pass a larger `sideOffset`. */
export function MenuContent({
  className,
  minWidth,
  style,
  sideOffset = 2,
  ...rest
}: MenuContentProps) {
  const mergedStyle: CSSProperties | undefined =
    minWidth === undefined ? style : { minWidth, ...style };
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={clsx(styles.content, className)}
        align="start"
        sideOffset={sideOffset}
        style={mergedStyle}
        {...rest}
      />
    </DropdownMenu.Portal>
  );
}

export interface MenuGroupProps extends ComponentPropsWithoutRef<typeof DropdownMenu.Group> {
  /** Section header text. Omit for an unlabelled section (the ungrouped bucket
   * `ui/option-groups.ts`'s `groupOptions` puts last) — the group still nests its items, it just
   * renders no header row. */
  label?: string;
}

/** Labelled section of menu items — the render half of the grouped-picker mechanic whose data
 * half is `ui/option-groups.ts`. The header is a Radix `DropdownMenu.Label`, which is
 * deliberately NOT focusable, so roving focus and typeahead skip headers with no extra work at
 * the call site. It sticks to the top of whatever scroll container the group sits in (see
 * `.groupLabel`), so the provider/section a row belongs to stays visible while scrolling a long
 * list — the whole point of grouping a picker that outgrew one flat list. */
export function MenuGroup({ label, className, children, ...rest }: MenuGroupProps) {
  const labelId = useId();
  return (
    <DropdownMenu.Group
      className={className}
      aria-labelledby={label === undefined ? undefined : labelId}
      {...rest}
    >
      {label !== undefined && (
        <DropdownMenu.Label id={labelId} className={styles.groupLabel}>
          {label}
        </DropdownMenu.Label>
      )}
      {children}
    </DropdownMenu.Group>
  );
}

export interface MenuItemProps extends ComponentPropsWithoutRef<typeof DropdownMenu.Item> {
  /** Destructive action styling (delete/archive/remove — red text). */
  danger?: boolean;
}

export function MenuItem({ className, danger, ...rest }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={clsx(styles.item, danger && styles.danger, className)}
      {...rest}
    />
  );
}

export function MenuSeparator(props: ComponentPropsWithoutRef<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={styles.sep} {...props} />;
}
