/**
 * AgentStatusDot — 8×8 circle whose color reflects agent status.
 * ui-components.md § Status dots & avatars
 */

import styles from "./StatusDot.module.css";
import { statusDotColor, STATUS_DOT_SIZE, type StatusDotInput } from "../../ui/status-dot.js";

const COLOR_TOKEN_VAR: Record<string, string> = {
  accent: "var(--pi-color-accent)",
  statusSuccess: "var(--pi-color-statusSuccess)",
  statusDanger: "var(--pi-color-statusDanger)",
  statusWarning: "var(--pi-color-statusWarning)",
  foregroundMuted: "var(--pi-color-foregroundMuted)",
};

export type StatusDotProps = StatusDotInput & {
  className?: string;
};

export function StatusDot({ className, ...input }: StatusDotProps) {
  const colorToken = statusDotColor(input);
  if (!colorToken) return null;

  return (
    <span
      className={`${styles.dot}${className ? ` ${className}` : ""}`}
      style={{
        width: STATUS_DOT_SIZE,
        height: STATUS_DOT_SIZE,
        backgroundColor: COLOR_TOKEN_VAR[colorToken] ?? "currentColor",
      }}
      role="presentation"
    />
  );
}
