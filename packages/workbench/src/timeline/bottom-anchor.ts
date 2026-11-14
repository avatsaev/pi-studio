/**
 * Bottom-anchor policy for the chat timeline — the pure half of "follow the live agent output"
 * (features/timeline-rendering.md § Autoscroll / bottom anchoring). `features/chat/
 * use-bottom-anchor.ts` is the DOM half; no React, no DOM here, so every transition is directly
 * unit-testable under this project's node-environment vitest run.
 *
 * The whole policy is one boolean and two rules:
 *
 *   **Only a user gesture can detach. Only proximity to the bottom can re-attach.**
 *
 * That asymmetry is the point. The previous controller derived "still following?" from the raw
 * scroll position on every scroll event, so a *programmatic* scroll that momentarily landed far
 * from the bottom — a virtualizer re-measure correction, the scroll offset a `display:none` tab
 * restores when it becomes visible again, StrictMode's re-attach — silently turned following off
 * with no user input, and it stayed off for the rest of the turn. Gesture-gating removes that
 * whole class of failure without a single "is this scroll mine?" suppression flag.
 *
 * Staying pinned through *content* growth is deliberately NOT this module's job: the virtualizer
 * does it natively via `anchorTo: "end"`, inside its resize handling and before paint, which is
 * the one part of this that cannot be done correctly from an effect (see `Timeline.tsx`).
 */

import type { TimelineRow } from "./row-model.js";

/**
 * Distance from the bottom, in px, at which the view still counts as "at the bottom" — both for
 * detaching (a gesture must carry you further than this) and re-attaching (scrolling back within
 * it re-pins). Also handed to the virtualizer as `scrollEndThreshold` so its native end-anchoring
 * agrees with this module instead of maintaining a second, slightly different idea of "at the
 * end": one constant, one meaning.
 */
export const AT_BOTTOM_THRESHOLD_PX = 64;

export interface ViewportMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export type AnchorEvent =
  /** The viewport scrolled. `gesture` marks a scroll a user input produced. */
  | { kind: "scroll"; gesture: boolean }
  /** Rows were appended/replaced — follow the new tail if still pinned. */
  | { kind: "tail" }
  /** The viewport became measurable again (hidden tab shown, pane/window resized). */
  | { kind: "shown" }
  /** An explicit request to be at the bottom: jump-to-latest, or the user's own new message. */
  | { kind: "pin" };

export interface AnchorDecision {
  pinned: boolean;
  /** The caller must scroll the viewport to its very end now. */
  stick: boolean;
}

/**
 * Whether the viewport has a layout box at all. A chat tab that is not its pane's active tab
 * stays mounted under `display:none` (`TabPanelHost`), which collapses the scroller to 0×0: every
 * metric reads 0 and — verified in a live browser — `scrollTop` **writes are ignored**. So while
 * hidden, no scroll position can be measured or applied, and every metric-derived decision would
 * be a lie. Pinned state is simply held across the hidden period and re-asserted on `shown`.
 */
export function isLaidOut(metrics: ViewportMetrics): boolean {
  return metrics.clientHeight > 0;
}

export function nextAnchorState(
  pinned: boolean,
  event: AnchorEvent,
  metrics: ViewportMetrics,
  threshold: number = AT_BOTTOM_THRESHOLD_PX,
): AnchorDecision {
  switch (event.kind) {
    case "scroll": {
      // Nothing measurable while hidden — hold the current state rather than invent one.
      if (!isLaidOut(metrics)) return { pinned, stick: false };
      const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
      if (distance <= threshold) return { pinned: true, stick: false };
      return { pinned: event.gesture ? false : pinned, stick: false };
    }
    case "tail":
      return { pinned, stick: pinned && isLaidOut(metrics) };
    case "shown":
      return { pinned, stick: pinned };
    case "pin":
      // Pin even while hidden: `shown` re-asserts it the moment the tab can be scrolled again.
      return { pinned: true, stick: isLaidOut(metrics) };
  }
}

/**
 * The id of the last row when it is a user message, else `null` — the signal for "the user just
 * sent something", which always pulls the view back to the bottom even from a detached state
 * (features/timeline-rendering.md § Autoscroll, "local requests"). Reading the *last* row rather
 * than counting user rows is what makes it usable as a React effect dependency: it changes on
 * exactly the render that introduces a new trailing user row (`Composer`'s optimistic echo) and
 * goes back to `null` as soon as the agent answers.
 */
export function lastRowUserId(rows: readonly TimelineRow[]): string | null {
  const last = rows[rows.length - 1];
  return last?.kind === "user" ? last.id : null;
}
