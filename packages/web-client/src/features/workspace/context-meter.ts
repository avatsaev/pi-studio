/**
 * Pure state for the status bar's context meter (sprint-074). No store/DOM access: every function
 * takes plain values, so the whole decision table is unit-testable.
 */

import type { SessionStats } from "@pi-studio-ui/stores/stats-store.js";
import { formatPercent, formatTokens } from "./status-bar-format.js";

export type MeterState =
  | { kind: "compacting" }
  | { kind: "unknown" }
  | { kind: "value"; fraction: number; estimated: boolean };

export type MeterTone = "normal" | "warning" | "danger";

const WARNING_AT = 0.7;
const DANGER_AT = 0.9;

/** Compacting wins over everything; otherwise tokens/window beats the reported percent. */
export function meterState(stats: SessionStats | undefined, compacting: boolean): MeterState {
  if (compacting) return { kind: "compacting" };
  const estimated = stats?.contextEstimated === true;
  if (stats?.contextTokens !== undefined && stats.contextWindow) {
    return { kind: "value", fraction: stats.contextTokens / stats.contextWindow, estimated };
  }
  if (stats?.contextPercent !== undefined) {
    return { kind: "value", fraction: stats.contextPercent / 100, estimated };
  }
  return { kind: "unknown" };
}

export function meterTone(fraction: number): MeterTone {
  if (fraction >= DANGER_AT) return "danger";
  if (fraction >= WARNING_AT) return "warning";
  return "normal";
}

/** The bar's fill width as a 0–1 fraction. */
export function meterFill(state: MeterState): number {
  return state.kind === "value" ? Math.min(Math.max(state.fraction, 0), 1) : 0;
}

export function meterText(state: MeterState): string {
  switch (state.kind) {
    case "compacting":
      return "Compacting…";
    case "unknown":
      return "—";
    case "value":
      return `${state.estimated ? "~" : ""}${formatPercent(state.fraction * 100)}`;
  }
}

/** Tooltip: the absolute token numbers, flagged when they are Pi's post-compaction estimate. */
export function meterTitle(stats: SessionStats | undefined, state: MeterState): string {
  if (state.kind === "compacting") return "Compacting context…";
  if (state.kind === "unknown") return "Context usage unknown";
  const window = formatTokens(stats?.contextWindow);
  const tokens =
    stats?.contextTokens !== undefined && stats.contextWindow
      ? formatTokens(stats.contextTokens)
      : undefined;
  if (tokens === undefined) return `${meterText(state)} of ${window} tokens`;
  return state.estimated
    ? `≈ ${tokens} / ${window} tokens (estimate)`
    : `${tokens} / ${window} tokens`;
}

/** `aria-valuenow` (0–100), omitted when there is no value to report. */
export function meterValueNow(state: MeterState): number | undefined {
  return state.kind === "value" ? Math.round(meterFill(state) * 100) : undefined;
}
