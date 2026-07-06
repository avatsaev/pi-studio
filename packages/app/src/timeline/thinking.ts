// Thinking-token card model: elapsed timer, auto-collapse when response begins,
// shimmer while active.
//
// clean-room-scope/features/timeline-rendering.md § Reasoning ("thinking"),
// task-003 § Thinking card

export type ThinkingStatus = "active" | "done";

export interface ThinkingCardModel {
  text: string;
  status: ThinkingStatus;
  /** Elapsed ms since thinking began (frozen once done). */
  elapsedMs: number;
  /** Whether the card should be collapsed (auto-collapses once the response starts). */
  collapsed: boolean;
  /** Whether to render the shimmer indicator (active + not yet responding). */
  shimmer: boolean;
}

export interface ThinkingInput {
  text: string;
  /** True while reasoning tokens are still streaming. */
  active: boolean;
  startedAt: number;
  now: number;
  /** True once assistant response text has begun (triggers auto-collapse). */
  responseStarted: boolean;
  /** User's manual expand/collapse override, if any. */
  manualCollapsed?: boolean;
}

export function buildThinkingCard(input: ThinkingInput): ThinkingCardModel {
  const status: ThinkingStatus = input.active && !input.responseStarted ? "active" : "done";
  const elapsedMs = Math.max(0, input.now - input.startedAt);
  // Auto-collapse when the response starts, unless the user manually toggled.
  const autoCollapsed = input.responseStarted;
  const collapsed = input.manualCollapsed ?? autoCollapsed;
  return {
    text: input.text,
    status,
    elapsedMs,
    collapsed,
    shimmer: status === "active",
  };
}

/** "Thinking…" while active; "Thought for 3s" once done. */
export function thinkingLabel(model: ThinkingCardModel): string {
  if (model.status === "active") return "Thinking…";
  return `Thought for ${formatElapsed(model.elapsedMs)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}
