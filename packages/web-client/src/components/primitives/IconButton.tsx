/**
 * IconButton — compact, chromeless icon affordance for row actions and menu triggers (file-row
 * "⋮", session-row "⋮", workspace-header chevron/"⋮", Dialog's inline close, TabStrip's "+").
 * Distinct from `Button`'s `iconOnly` mode: `Button` sizes from 28px up (a labeled-CTA minimum
 * tap target) and hovers to a fixed `surface1` — too large and the wrong hover color for a tiny
 * hover-reveal affordance sitting inside an already-compact row (20px tall, absolutely
 * positioned, opacity-on-row-hover) against a variety of ambient backgrounds
 * (`surfaceSidebar`/`surfaceWorkspace`/page `background`/`surface1`, matching each row's own
 * container — see `--icon-btn-hover-base` below). ui-components.md § Pressables
 */

import { type ButtonHTMLAttributes, type CSSProperties } from "react";
import { clsx } from "clsx";
import styles from "./IconButton.module.css";

type StyleWithVars = CSSProperties & { [customProperty: `--${string}`]: string | undefined };

export type IconButtonSize = "xs" | "sm";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `xs` (20px) — row actions and menu triggers, the common case. `sm` (28px) — a standalone
   * button not embedded in a compact row, e.g. Dialog's inline header close. */
  size?: IconButtonSize;
  /** Overrides the hover background's base color (mixed 85/15 with `foreground`, matching
   * `theme/color-utils.ts`'s app-wide hover-lift recipe) — defaults to `--pi-color-surface1`,
   * the right base for a button sitting directly on a panel surface. A button sitting on a
   * different ambient background (the sidebar, page background, a workspace header) passes the
   * matching token, e.g. `hoverBase="var(--pi-color-surfaceSidebar)"`. */
  hoverBase?: string;
}

export function IconButton({
  size = "xs",
  hoverBase,
  className,
  style,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={clsx(styles.iconBtn, styles[size], className)}
      style={
        hoverBase ? ({ "--icon-btn-hover-base": hoverBase, ...style } as StyleWithVars) : style
      }
      {...rest}
    />
  );
}
