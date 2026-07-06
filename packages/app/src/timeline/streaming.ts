// Streaming assistant-message rendering: token accumulation, frame-batched
// flush scheduling, and streaming-cursor state.
//
// clean-room-scope/features/timeline-rendering.md § streaming, § The render model
//
// All pure / framework-agnostic — the React layer supplies a real
// requestAnimationFrame-based scheduler; tests supply a synchronous fake.

// ─── Token accumulation ───────────────────────────────────────────────────────

export interface StreamState {
  /** Accumulated text so far. */
  text: string;
  /** True while tokens are still arriving (cursor shown). */
  streaming: boolean;
}

export const EMPTY_STREAM: StreamState = { text: "", streaming: false };

/** Append a token/delta to the accumulated text and mark as streaming. */
export function appendDelta(state: StreamState, delta: string): StreamState {
  return { text: state.text + delta, streaming: true };
}

/**
 * Apply a stream event to accumulated state. Supports two shapes:
 *  - `{ delta }` — append the delta (streaming continues)
 *  - `{ text }`  — replace with the full snapshot (some providers send the
 *    full accumulated text each frame)
 */
export function applyStreamDelta(
  state: StreamState,
  event: { delta?: string; text?: string },
): StreamState {
  if (typeof event.delta === "string") return appendDelta(state, event.delta);
  if (typeof event.text === "string") return { text: event.text, streaming: true };
  return state;
}

/** Mark the stream complete (cursor hidden); text is preserved. */
export function endStream(state: StreamState): StreamState {
  return { text: state.text, streaming: false };
}

// ─── Streaming cursor ──────────────────────────────────────────────────────────

/** The trailing streaming cursor glyph. */
export const STREAM_CURSOR = "▍";

/** Whether a blinking cursor should be shown for a row. */
export function shouldShowCursor(state: Pick<StreamState, "streaming">): boolean {
  return state.streaming === true;
}

// ─── Frame batcher (RAF coalescing) ─────────────────────────────────────────────

export type ScheduleFn = (cb: () => void) => number;
export type CancelFn = (handle: number) => void;

export interface FrameBatcher<T> {
  /** Queue a value; only the latest value per frame is flushed. */
  push(value: T): void;
  /** Force an immediate flush of any pending value. */
  flushNow(): void;
  /** Cancel any pending flush without emitting. */
  cancel(): void;
  /** Number of flushes performed (for diagnostics/tests). */
  readonly flushCount: number;
}

/**
 * Coalesce rapid `push()` calls into at most one `flush(value)` per animation
 * frame (~16ms). Only the most recent value is delivered per frame, so fast
 * token streams don't trigger a re-render per token.
 *
 * The scheduler is injected: the app passes `requestAnimationFrame` /
 * `cancelAnimationFrame`; tests pass a controllable fake.
 */
export function createFrameBatcher<T>(
  flush: (value: T) => void,
  schedule: ScheduleFn = defaultSchedule,
  cancelSchedule: CancelFn = defaultCancel,
): FrameBatcher<T> {
  let handle: number | null = null;
  let hasPending = false;
  let pending: T | undefined;
  let flushCount = 0;

  const doFlush = () => {
    handle = null;
    if (!hasPending) return;
    hasPending = false;
    const value = pending as T;
    pending = undefined;
    flushCount++;
    flush(value);
  };

  return {
    push(value: T) {
      pending = value;
      hasPending = true;
      if (handle === null) handle = schedule(doFlush);
    },
    flushNow() {
      if (handle !== null) {
        cancelSchedule(handle);
        handle = null;
      }
      doFlush();
    },
    cancel() {
      if (handle !== null) {
        cancelSchedule(handle);
        handle = null;
      }
      hasPending = false;
      pending = undefined;
    },
    get flushCount() {
      return flushCount;
    },
  };
}

const defaultSchedule: ScheduleFn = (cb) => {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(cb);
  return setTimeout(cb, 16) as unknown as number;
};

const defaultCancel: CancelFn = (handle) => {
  if (typeof cancelAnimationFrame === "function") return cancelAnimationFrame(handle);
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
};
