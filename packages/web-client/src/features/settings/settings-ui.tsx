/**
 * Settings UI primitives — the local echo of Paseo's `styles/settings.ts`
 * (docs/design.md §7 density rhythm): `SettingsSection` owns its 24px bottom margin and a
 * 12px muted sentence-case label; cards are `Surface` containers whose rows touch,
 * separated only by 1px top dividers; a row is title(+hint) left, control/value right.
 */

import { type ReactNode } from "react";
import { clsx } from "clsx";
import styles from "./settings-ui.module.css";

export function SettingsSection({
  label,
  children,
  flush = false,
}: {
  label: string;
  children: ReactNode;
  /** Drop the bottom margin when this is the last section on the page. */
  flush?: boolean;
}) {
  return (
    <section className={clsx(styles.section, flush && styles.flush)}>
      <h2 className={styles.sectionLabel}>{label}</h2>
      {children}
    </section>
  );
}

export function SettingsRow({
  title,
  hint,
  control,
}: {
  title: ReactNode;
  hint?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowContent}>
        <div className={styles.rowTitle}>{title}</div>
        {hint && <div className={styles.rowHint}>{hint}</div>}
      </div>
      {control}
    </div>
  );
}

export type StatusPillTone = "success" | "warning" | "muted";

export function StatusPill({ tone, label }: { tone: StatusPillTone; label: string }) {
  return (
    <span className={clsx(styles.pill, styles[`pill_${tone}`])}>
      <span className={styles.pillDot} aria-hidden />
      {label}
    </span>
  );
}
