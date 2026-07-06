/**
 * StatusBadge — small rounded pill with variant coloring.
 * ui-components.md § Surfaces / badges / chips / avatars
 */

import { type ReactNode } from "react";
import styles from "./StatusBadge.module.css";
import { statusBadgeTokens, type StatusBadgeVariant } from "../../ui/status-badge.js";

export interface StatusBadgeProps {
  label: ReactNode;
  variant: StatusBadgeVariant;
  className?: string;
}

export function StatusBadge({ label, variant, className }: StatusBadgeProps) {
  const tokens = statusBadgeTokens(variant);
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      style={{
        backgroundColor: `var(--pi-color-${tokens.bg})`,
        borderColor: `var(--pi-color-${tokens.border})`,
        color: `var(--pi-color-${tokens.text})`,
      }}
    >
      {label}
    </span>
  );
}
