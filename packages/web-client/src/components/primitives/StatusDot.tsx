/**
 * AgentStatusDot — 8×8 circle whose color reflects agent status.
 * ui-components.md § Status dots & avatars
 */

import styles from "./StatusDot.module.css";
import {
  statusDotColor,
  STATUS_DOT_SIZE,
  type StatusDotInput,
} from "@pi-studio-ui/ui/status-dot.js";

const COLOR_TOKEN_VAR: Record<string, string> = {
  accent: "var(--pi-color-accent)",
  statusSuccess: "var(--pi-color-statusSuccess)",
  statusDanger: "var(--pi-color-statusDanger)",
  statusWarning: "var(--pi-color-statusWarning)",
  foregroundMuted: "var(--pi-color-foregroundMuted)",
};

export type StatusDotProps = StatusDotInput & {
  className?: string;
  /** Opt-in box-shadow ring, local to the needs-input state (sprint-069/task-002) — never part of
   * `StatusDot`'s default rendering, so every other status/caller is unaffected. Defaults off. */
  pulse?: boolean;
  /** When set, the dot becomes an accessible element carrying this name instead of the default
   * `role="presentation"` (§ 08: "no dot is ever colour-only") — sprint-069/task-003. Omitted ⇒
   * today's decorative default, unchanged for every existing caller. */
  "aria-label"?: string;
};

export function StatusDot({ className, pulse, "aria-label": ariaLabel, ...input }: StatusDotProps) {
  const colorToken = statusDotColor(input);
  if (!colorToken) return null;

  // Running (and not overridden by an attention state) gets a spinning ring instead of a flat
  // dot — a static "blue circle" reads as just another status color, not as work in progress.
  const spinning = input.status === "running" && !input.requiresAttention;
  const color = spinning
    ? "var(--pi-color-accentBright, #a2b4d7)" // brighter than plain accent — must read clearly
    : // against the dark surface at the small size this ring renders at.
      (COLOR_TOKEN_VAR[colorToken] ?? "currentColor");

  return (
    <span
      className={`${spinning ? styles.spinner : styles.dot}${
        pulse && !spinning ? ` ${styles.pulse}` : ""
      }${className ? ` ${className}` : ""}`}
      style={
        spinning
          ? { borderTopColor: color, borderRightColor: color }
          : {
              width: `var(--status-dot-size, ${STATUS_DOT_SIZE}px)`,
              height: `var(--status-dot-size, ${STATUS_DOT_SIZE}px)`,
              backgroundColor: color,
            }
      }
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
    />
  );
}
