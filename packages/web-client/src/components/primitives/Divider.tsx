/**
 * Divider — a 1px separator line.
 * ui-components.md § Scroll & dividers
 */

import styles from "./Divider.module.css";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function Divider({ orientation = "horizontal", className }: DividerProps) {
  return (
    <hr
      className={`${styles.divider} ${orientation === "vertical" ? styles.vertical : styles.horizontal}${className ? ` ${className}` : ""}`}
      aria-orientation={orientation}
      role="separator"
    />
  );
}
