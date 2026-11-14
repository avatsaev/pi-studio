/**
 * TurnProgressBar — the redesign's turn-progress indicator (sprint-060): an indeterminate 2px
 * accent sweep mounted absolutely across the top of `ChatPanel`'s body, directly under that
 * pane's tab strip. Purely presentational — takes the pane's running state as a prop rather than
 * subscribing to the session store itself, so it never re-renders on unrelated timeline mutations
 * (see `ChatPanel.tsx`, which already holds the session).
 *
 * Design source: `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 05.
 */

import styles from "./TurnProgressBar.module.css";

export interface TurnProgressBarProps {
  running: boolean;
}

export function TurnProgressBar({ running }: TurnProgressBarProps) {
  if (!running) return null;

  return (
    <div className={styles.track} role="progressbar" aria-label="Turn in progress">
      <div className={styles.sweep} aria-hidden="true" />
      <span className={styles.visuallyHidden} role="status" aria-live="polite">
        Agent is working…
      </span>
    </div>
  );
}
