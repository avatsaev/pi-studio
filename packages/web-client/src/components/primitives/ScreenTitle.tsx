/**
 * ScreenTitle — canonical top-of-screen title. Mirrors Paseo's
 * `components/headers/screen-title.tsx`: fontSize base, weight 400 on compact /
 * 300 on desktop, `foreground` color. Leading icons/badges are siblings, never
 * nested inside this component.
 *
 * clean-room-scope docs/design.md §3 (hierarchy via weight+color, not size).
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";
import styles from "./ScreenTitle.module.css";

export interface ScreenTitleProps {
  children: ReactNode;
  className?: string;
}

export function ScreenTitle({ children, className }: ScreenTitleProps) {
  return <h1 className={clsx(styles.title, className)}>{children}</h1>;
}
