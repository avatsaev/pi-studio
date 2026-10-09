/**
 * ContextMeter — the status bar's context segment body (sprint-074): an 80 × 6 px loading-bar
 * track instead of the old `42% (84k/200k)` text. All decisions (fraction, tone, text, tooltip)
 * come from `context-meter.ts`; this component only maps them to markup. Non-interactive here —
 * the popover trigger wrapper is task-007's.
 */

import { clsx } from "clsx";
import type { SessionStats } from "@pi-studio-ui/stores/stats-store.js";
import {
  meterFill,
  meterState,
  meterText,
  meterTitle,
  meterTone,
  meterValueNow,
} from "./context-meter.js";
import styles from "./ContextMeter.module.css";

export interface ContextMeterProps {
  stats: SessionStats | undefined;
  compacting: boolean;
  /** Stretch the track to the container's width (the popover's copy) instead of the 80 px bar. */
  wide?: boolean;
}

export function ContextMeter({ stats, compacting, wide = false }: ContextMeterProps) {
  const state = meterState(stats, compacting);
  const text = meterText(state);
  const valueNow = meterValueNow(state);
  const estimated = state.kind === "value" && state.estimated;
  const tone = state.kind === "value" ? meterTone(state.fraction) : "normal";

  return (
    <span className={clsx(styles.meter, wide && styles.meterWide)} title={meterTitle(stats, state)}>
      <span
        role="meter"
        aria-label="Context usage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valueNow}
        aria-valuetext={state.kind === "value" && !estimated ? undefined : text}
        className={clsx(
          styles.track,
          wide && styles.trackWide,
          state.kind === "unknown" && styles.trackUnknown,
          state.kind === "compacting" && styles.trackCompacting,
        )}
      >
        {state.kind === "value" && (
          <span
            className={clsx(
              styles.fill,
              tone === "warning" && styles.fillWarning,
              tone === "danger" && styles.fillDanger,
              estimated && styles.fillEstimated,
            )}
            style={{ width: `${meterFill(state) * 100}%` }}
          />
        )}
        {state.kind === "compacting" && <span className={styles.sweep} />}
      </span>
      <span className={styles.label}>{text}</span>
    </span>
  );
}
