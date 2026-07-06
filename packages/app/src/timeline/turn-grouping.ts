// Turn grouping, spacing, and footer assembly.
// clean-room-scope/features/timeline-rendering.md § Turn grouping, spacing & footers

import type { TimelineRow } from "./reducer.js";

export type TurnStatus = "running" | "completed";

export type TurnGroup = {
  turnId: string;
  rows: TimelineRow[];
  status: TurnStatus;
  /** ISO timestamp of the first user message in this turn. */
  startedAt?: number;
  /** Duration in ms (set when completed). */
  durationMs?: number;
  completedAt?: number;
};

export type TurnFooter = {
  turnId: string;
  status: TurnStatus;
  durationMs?: number;
  completedAt?: number;
  /** The last assistant message in this turn (for copy-button placement). */
  anchorRowId?: string;
};

export function segmentIntoTurns(rows: readonly TimelineRow[]): TurnGroup[] {
  const turns: TurnGroup[] = [];
  let current: TurnGroup | undefined;
  let turnCounter = 0;

  for (const row of rows) {
    if (row.kind === "user_message") {
      // A user_message starts a new turn
      current = {
        turnId: `turn-${turnCounter++}`,
        rows: [row],
        status: "running",
        startedAt: row.timestamp,
      };
      turns.push(current);
    } else {
      if (!current) {
        // Rows before any user message get their own synthetic turn
        current = { turnId: `turn-${turnCounter++}`, rows: [], status: "running" };
        turns.push(current);
      }
      current.rows.push(row);
    }
  }
  return turns;
}

export function buildTurnFooter(turn: TurnGroup, isLastTurn: boolean, agentRunning: boolean): TurnFooter | undefined {
  // Only emit a footer after the turn's last assistant message
  const lastAssistant = [...turn.rows].reverse().find((row) => row.kind === "assistant_message");
  if (!lastAssistant) return undefined;
  if (agentRunning && isLastTurn) {
    return { turnId: turn.turnId, status: "running", anchorRowId: lastAssistant.rowId };
  }
  const durationMs = turn.completedAt != null && turn.startedAt != null ? turn.completedAt - turn.startedAt : undefined;
  return {
    turnId: turn.turnId,
    status: "completed",
    durationMs,
    completedAt: turn.completedAt,
    anchorRowId: lastAssistant.rowId,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export function formatTurnFooterLabel(footer: TurnFooter): string {
  if (footer.status === "running") return "Working…";
  if (footer.durationMs != null) return `Worked for ${formatDuration(footer.durationMs)}`;
  return "Done";
}

/**
 * Turn footer label with an optional token count from usage data, e.g.
 * "Worked for 3s · 1.2k tokens". Token count omitted when not provided.
 */
export function formatTurnFooterWithUsage(
  footer: TurnFooter,
  totalTokens?: number,
): string {
  const base = formatTurnFooterLabel(footer);
  if (footer.status === "running" || totalTokens == null || totalTokens <= 0) return base;
  return `${base} · ${formatTokenCount(totalTokens)} tokens`;
}

function formatTokenCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

// Detect whether consecutive rows share a block group and should suppress repeated author chrome.
export function shouldSuppressChrome(prevRow: TimelineRow | undefined, row: TimelineRow): boolean {
  if (!prevRow) return false;
  if (row.kind !== "assistant_message" || prevRow.kind !== "assistant_message") return false;
  const prevGroup = (prevRow.payload as { blockGroupId?: string } | null)?.blockGroupId;
  const currGroup = (row.payload as { blockGroupId?: string } | null)?.blockGroupId;
  return Boolean(prevGroup && currGroup && prevGroup === currGroup);
}
