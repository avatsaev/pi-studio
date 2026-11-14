/**
 * ScrollArea — a themed scrollable container.
 * ui-components.md § Scroll & dividers
 */

import { type ReactNode, type HTMLAttributes } from "react";
import { clsx } from "clsx";
import styles from "./ScrollArea.module.css";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  axis?: "both" | "x" | "y";
  children?: ReactNode;
}

export function ScrollArea({ axis = "both", className, children, ...rest }: ScrollAreaProps) {
  return (
    <div
      className={clsx(
        styles.scrollArea,
        axis === "x" && styles.x,
        axis === "y" && styles.y,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
