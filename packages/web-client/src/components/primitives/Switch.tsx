/**
 * Switch — animated toggle control.
 * ui-components.md § Inputs & form controls (Switch)
 */

import styles from "./Switch.module.css";
import { clsx } from "clsx";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  "aria-label": ariaLabel,
  className,
}: SwitchProps) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={clsx(
        styles.track,
        checked && styles.checked,
        disabled && styles.disabled,
        className,
      )}
      onClick={() => !disabled && onCheckedChange(!checked)}
      type="button"
    >
      <span className={styles.thumb} />
    </button>
  );
}
