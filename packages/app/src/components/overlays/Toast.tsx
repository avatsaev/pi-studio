/**
 * ToastHost + Toast — renders the active toast queue via the overlay root portal.
 * ui-components.md § Feedback — Toasts
 */

import { clsx } from "clsx";
import { CheckCircle, XCircle, Info } from "lucide-react";
import styles from "./Toast.module.css";
import { Portal } from "./Portal.js";
import { useToast } from "./ToastContext.js";
import { type ToastVariant } from "../../ui/toast.js";

const TOAST_ICON: Record<ToastVariant, React.ElementType | null> = {
  default: Info,
  success: CheckCircle,
  error: XCircle,
};

export function ToastHost() {
  const { toasts, dismiss, pauseTimer, resumeTimer } = useToast();

  if (toasts.length === 0) return null;

  return (
    <Portal>
      <div className={styles.host} role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((entry) => {
          const IconComp = entry.icon ? null : TOAST_ICON[entry.variant];
          return (
            <div
              key={entry.id}
              className={clsx(
                styles.toast,
                entry.variant === "success" && styles.success,
                entry.variant === "error" && styles.error,
              )}
              onPointerEnter={() => pauseTimer(entry.id)}
              onPointerLeave={() => resumeTimer(entry.id)}
              onClick={() => dismiss(entry.id)}
              role="alert"
              aria-label={entry.content}
            >
              {IconComp && <IconComp size={14} aria-hidden />}
              <span>{entry.content}</span>
            </div>
          );
        })}
      </div>
    </Portal>
  );
}
