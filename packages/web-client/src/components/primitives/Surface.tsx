/**
 * Surface / Card — an elevated container reading surface tokens.
 * ui-components.md § Surfaces / badges / chips / avatars
 */

import { type ReactNode, type HTMLAttributes } from "react";
import { clsx } from "clsx";
import styles from "./Surface.module.css";
import { type SurfaceElevation } from "./helpers.js";

const ELEVATION_CLASS: Record<SurfaceElevation, string> = {
  0: styles.el0!,
  1: styles.el1!,
  2: styles.el2!,
  3: styles.el3!,
  4: styles.el3!, // 4 uses surface3 (no surface4 token defined in CSS vars)
};

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: SurfaceElevation;
  noBorder?: boolean;
  children?: ReactNode;
}

export function Surface({
  elevation = 1,
  noBorder = false,
  className,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <div
      className={clsx(
        styles.surface,
        ELEVATION_CLASS[elevation],
        noBorder && styles.noBorder,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
