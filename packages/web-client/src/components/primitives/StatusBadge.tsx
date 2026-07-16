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
  const { token } = statusBadgeTokens(variant);
  const color = `var(--pi-color-${token})`;
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  );
}
