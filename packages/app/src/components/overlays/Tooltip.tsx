/**
 * Tooltip — compound component built on @radix-ui/react-tooltip.
 * Desktop-only (hover + keyboard focus); compact = on-press.
 * ui-components.md § Overlays — Tooltip
 */

import { type ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  offset?: number;
  delayDuration?: number;
  /** Set false to disable; defaults to true on desktop. */
  enabled?: boolean;
}

/** Wrap the whole app (or section) in this provider. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  offset = 6,
  delayDuration,
  enabled = true,
}: TooltipProps) {
  if (!enabled) return <>{children}</>;

  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          className={styles.content}
          side={side}
          align={align}
          sideOffset={offset}
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
