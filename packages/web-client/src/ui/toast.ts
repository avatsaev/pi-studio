// Toast system — API, variants, timer state, and Esc-stack.
// ui-components.md § Feedback

export type ToastVariant = "default" | "success" | "error";

export type ToastOptions = {
  icon?: string;
  variant?: ToastVariant;
  /** Duration in ms. null = sticky (never auto-dismisses). Default ~2200ms. */
  durationMs?: number | null;
  /** Android-only: delegate to native toast instead of the in-app one. */
  nativeAndroid?: boolean;
};

export const DEFAULT_TOAST_DURATION_MS = 2200;

export type ToastEntry = {
  id: string;
  content: string;
  variant: ToastVariant;
  durationMs: number | null;
  icon?: string;
  /** True while the hover-pause is active (web desktop only). */
  paused: boolean;
  /** Epoch ms when the toast was shown (used to compute remaining time). */
  shownAt: number;
};

/** Build a toast entry from show() arguments. */
export function buildToastEntry(
  id: string,
  content: string,
  opts: ToastOptions,
  now = Date.now(),
): ToastEntry {
  return {
    id,
    content,
    variant: opts.variant ?? "default",
    durationMs: opts.durationMs !== undefined ? opts.durationMs : DEFAULT_TOAST_DURATION_MS,
    icon: opts.icon,
    paused: false,
    shownAt: now,
  };
}

/** Convenience factory for a "copied" toast. */
export function copiedToast(label = "Copied"): { content: string; opts: ToastOptions } {
  return {
    content: label,
    opts: { variant: "success", durationMs: DEFAULT_TOAST_DURATION_MS },
  };
}

/** Convenience factory for an error toast. */
export function errorToast(message: string): { content: string; opts: ToastOptions } {
  return { content: message, opts: { variant: "error", durationMs: DEFAULT_TOAST_DURATION_MS } };
}

/**
 * Returns the remaining dismissal time (ms) for a toast, accounting for hover-pause.
 * If the toast is paused, remaining time is frozen at `pausedRemaining`.
 * Returns `null` for sticky toasts.
 */
export function remainingMs(
  entry: ToastEntry,
  pausedRemaining: number | null,
  now = Date.now(),
): number | null {
  if (entry.durationMs === null) return null; // sticky
  if (entry.paused && pausedRemaining !== null) return pausedRemaining;
  const elapsed = now - entry.shownAt;
  return Math.max(0, entry.durationMs - elapsed);
}

// ---------------------------------------------------------------------------
// Esc-stack — shared key-stack for modal/sheet close ordering.
// Topmost entry in the stack is closed first on Esc.
// ---------------------------------------------------------------------------

export class EscStack {
  private readonly _stack: Array<{ id: string; close: () => void }> = [];

  push(id: string, close: () => void): void {
    this._stack.push({ id, close });
  }

  pop(id: string): void {
    const idx = this._stack.findLastIndex((e) => e.id === id);
    if (idx !== -1) this._stack.splice(idx, 1);
  }

  /** Close the topmost entry (if any) and remove it. */
  closeTop(): boolean {
    const top = this._stack[this._stack.length - 1];
    if (!top) return false;
    top.close();
    this._stack.pop();
    return true;
  }

  get size(): number {
    return this._stack.length;
  }

  topId(): string | undefined {
    return this._stack[this._stack.length - 1]?.id;
  }
}
