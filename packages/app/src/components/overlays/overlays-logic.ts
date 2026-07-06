/**
 * Pure helpers for the overlay layer — testable without DOM.
 * Consumes sprint-012 overlay/toast models.
 */

export {
  resolveOverlayMode,
  Z_ORDER,
  type OverlayMode,
} from "../../platform/overlay.js";

export {
  EscStack,
  buildToastEntry,
  copiedToast,
  errorToast,
  remainingMs,
  DEFAULT_TOAST_DURATION_MS,
  type ToastEntry,
  type ToastOptions,
  type ToastVariant,
} from "../../ui/toast.js";

// ---------------------------------------------------------------------------
// Toast queue management (pure reducer for use in tests)
// ---------------------------------------------------------------------------

import { buildToastEntry, type ToastEntry, type ToastOptions } from "../../ui/toast.js";

let _queueIdCounter = 0;

export function newToastId(): string {
  return `t-${++_queueIdCounter}`;
}

export type ToastQueueAction =
  | { type: "add"; id: string; content: string; opts: ToastOptions }
  | { type: "dismiss"; id: string }
  | { type: "pause"; id: string }
  | { type: "resume"; id: string };

export function toastQueueReducer(
  queue: ToastEntry[],
  action: ToastQueueAction,
  now = Date.now(),
): ToastEntry[] {
  switch (action.type) {
    case "add":
      return [...queue, buildToastEntry(action.id, action.content, action.opts, now)];
    case "dismiss":
      return queue.filter((e) => e.id !== action.id);
    case "pause":
      return queue.map((e) => (e.id === action.id ? { ...e, paused: true } : e));
    case "resume":
      return queue.map((e) => (e.id === action.id ? { ...e, paused: false } : e));
  }
}
