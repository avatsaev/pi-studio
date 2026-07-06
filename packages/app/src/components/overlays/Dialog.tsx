/**
 * AdaptiveSheet — the primary modal/sheet primitive.
 * - Wide layout: centered card with backdrop over overlay root.
 * - Compact layout: bottom sheet.
 * Consumes the sprint-012 EscStack for ordered Esc-to-close.
 * ui-components.md § Overlays — AdaptiveModalSheet
 */

import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import styles from "./Dialog.module.css";
import { Portal } from "./Portal.js";
import { EscStack } from "../../ui/toast.js";

// Shared app-level Esc stack.
const escStack = new EscStack();

export interface AdaptiveSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Wide-layout panel max width (px). Default 480. */
  desktopMaxWidth?: number;
  /** When true, renders as compact bottom sheet regardless of viewport. */
  forceSheet?: boolean;
  className?: string;
}

let _sheetId = 0;

export function AdaptiveSheet({
  visible,
  onClose,
  title,
  children,
  footer,
  desktopMaxWidth = 480,
  forceSheet = false,
  className,
}: AdaptiveSheetProps) {
  // Register on the Esc stack when visible.
  const idRef = useCallback(() => `sheet-${++_sheetId}`, [])();

  useEffect(() => {
    if (!visible) return;
    escStack.push(idRef, onClose);
    return () => escStack.pop(idRef);
  }, [visible, idRef, onClose]);

  // Global Esc key handler — only closes the topmost registered sheet.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") escStack.closeTop();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  if (!visible) return null;

  if (forceSheet) {
    return (
      <Portal>
        <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal>
          <div
            className={clsx(styles.sheet, className)}
            onClick={(e) => e.stopPropagation()}
            aria-label={title}
          >
            <div className={styles.handle} />
            {title && (
              <div className={styles.header}>
                <h2 className={styles.title}>{title}</h2>
                <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            )}
            <div className={styles.body}>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
          </div>
        </div>
      </Portal>
    );
  }

  // Centered card (default / wide layout).
  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal>
        <div
          className={clsx(styles.panel, className)}
          style={{ maxWidth: desktopMaxWidth }}
          onClick={(e) => e.stopPropagation()}
          aria-label={title}
        >
          {title && (
            <div className={styles.header}>
              <h2 className={styles.title}>{title}</h2>
              <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
                <X size={16} />
              </button>
            </div>
          )}
          <div className={styles.body}>{children}</div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
