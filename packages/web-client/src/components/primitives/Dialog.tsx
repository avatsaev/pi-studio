/**
 * Dialog — generic centered modal chrome (overlay + card + header/title/close + optional footer),
 * wrapping Radix `Dialog` (design-system.md § Overlays: `@radix-ui/react-dialog` for
 * dialogs/menus/tooltips/popovers). Every feature-specific modal (workspace picker today; rename/
 * confirm dialogs later) SHOULD build on this instead of hand-rolling `Dialog.Root/Portal/Overlay/
 * Content` again — only the body content and footer actions vary per use.
 */

import { type ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { IconButton } from "./IconButton.js";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Body content between the header and the optional footer. */
  children?: ReactNode;
  /** Sticky action row rendered under the body (e.g. Cancel/Confirm buttons). */
  footer?: ReactNode;
  /** Content card width; defaults to 500px (design-system.md § Overlays desktop dialog sizing). */
  width?: number | string;
  /** Extra class applied to the content card, for callers that need to tweak body sizing. */
  className?: string;
  /**
   * Omit the header bar's reserved height and float the close button over the body instead.
   * Use for content (e.g. an image lightbox) that should sit dead-center in the viewport rather
   * than be pushed down by an asymmetric top-only header. `title` remains as an accessible
   * (visually hidden) label for the dialog.
   */
  bare?: boolean;
}

/** Re-exported so callers can wrap a footer button in `<Dialog.Close asChild>` to auto-dismiss
 * without threading `onOpenChange(false)` through their own click handler. */
export const DialogClose = RadixDialog.Close;

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  width,
  className,
  bare = false,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <div className={styles.contentWrapper}>
          <RadixDialog.Content
            className={clsx(styles.dialog, bare && styles.bare, className)}
            style={width !== undefined ? { width } : undefined}
          >
            {bare ? (
              <RadixDialog.Title className={styles.visuallyHidden}>{title}</RadixDialog.Title>
            ) : (
              <div className={styles.header}>
                <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
                <RadixDialog.Close asChild>
                  <IconButton size="sm" aria-label="Close">
                    <X size={16} />
                  </IconButton>
                </RadixDialog.Close>
              </div>
            )}
            <div className={clsx(styles.body, bare && styles.bareBody)}>{children}</div>
            {bare && (
              <RadixDialog.Close asChild>
                <IconButton
                  size="sm"
                  aria-label="Close"
                  className={styles.bareCloseBtn}
                  style={{
                    background: "var(--pi-color-surface1)",
                    border: "1px solid var(--pi-color-border)",
                    borderRadius: "50%",
                  }}
                >
                  <X size={16} />
                </IconButton>
              </RadixDialog.Close>
            )}
            {footer && <div className={styles.footer}>{footer}</div>}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
