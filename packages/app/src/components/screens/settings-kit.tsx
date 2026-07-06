/**
 * settings-kit — shared card / row / section / page-column primitives used
 * across the navigation screens. Mirrors Paseo's `styles/settings.ts` +
 * `screens/settings/settings-section.tsx` so every surface uses the same
 * semantic layout instead of bespoke inline styles.
 *
 * clean-room-scope docs/design.md §2 (component reuse), §5 (borders), §7 (density).
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";
import styles from "./settings-kit.module.css";

/** Centered, readable max-width 720 column for settings / list+detail content. */
export function PageColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx(styles.column, className)}>{children}</div>;
}

/** Grouped block: muted label above a stack of children (usually one Card). */
export function SettingsSection({
  title,
  trailing,
  children,
  className,
}: {
  title?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx(styles.section, className)}>
      {(title || trailing) && (
        <div className={styles.sectionHeader}>
          {title ? <span className={styles.sectionTitle}>{title}</span> : <span />}
          {trailing}
        </div>
      )}
      <div className={styles.sectionContent}>{children}</div>
    </section>
  );
}

/** One border around a logical group of rows. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx(styles.card, className)}>{children}</div>;
}

/** A settings row: primary title + optional hint/error, trailing control. */
export function SettingsRow({
  title,
  hint,
  error,
  trailing,
  onClick,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={clsx(styles.row, onClick && styles.rowInteractive, className)}
      onClick={onClick}
      {...(onClick ? { role: "button", tabIndex: 0 } : {})}
    >
      <div className={styles.rowContent}>
        <div className={styles.rowTitle}>{title}</div>
        {hint != null && <div className={styles.rowHint}>{hint}</div>}
        {error != null && <div className={styles.rowError}>{error}</div>}
      </div>
      {trailing != null && <div className={styles.rowTrailing}>{trailing}</div>}
    </div>
  );
}
