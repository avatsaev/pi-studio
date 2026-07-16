/**
 * Spinner — a thin activity-indicator circle.
 * ui-components.md § Feedback
 */

import styles from "./Spinner.module.css";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";
const SPINNER_SIZE_PX: Record<SpinnerSize, number> = { xs: 12, sm: 16, md: 20, lg: 24 };
const SPINNER_BORDER_PX: Record<SpinnerSize, number> = { xs: 1, sm: 2, md: 2, lg: 3 };

export interface SpinnerProps {
  size?: SpinnerSize | number;
  /** CSS color string; defaults to currentColor. */
  color?: string;
  className?: string;
  "aria-label"?: string;
}

export function Spinner({
  size = "md",
  color = "currentColor",
  className,
  "aria-label": ariaLabel = "Loading",
}: SpinnerProps) {
  const px = typeof size === "number" ? size : SPINNER_SIZE_PX[size];
  const borderPx =
    typeof size === "number"
      ? 2
      : SPINNER_BORDER_PX[size as SpinnerSize];

  return (
    <span
      className={`${styles.spinner}${className ? ` ${className}` : ""}`}
      role="status"
      aria-label={ariaLabel}
      style={{
        width: px,
        height: px,
        borderWidth: borderPx,
        color,
      }}
    />
  );
}
