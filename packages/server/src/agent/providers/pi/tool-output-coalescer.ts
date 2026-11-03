import type { AgentStreamEvent } from "@av-pi-studio/protocol";

/**
 * Per-`callId` rate and size control for ephemeral partial tool output
 * (features/tool-output-streaming.md § Server — per-callId coalescer).
 *
 * `PiAgentSession` routes every mapped event through `accept`. A `partial: true` `tool_call` is
 * owned by the coalescer from then on: it is delivered to subscribers (never recorded in the
 * session's replay history) on a leading + trailing edge at most every `PARTIAL_MIN_INTERVAL_MS`
 * per call, latest snapshot winning, with its output tail-capped. Any other event is handed back
 * unchanged for the caller's normal record-and-fan-out path, after the coalescer has dropped the
 * state it supersedes:
 *
 * - a non-partial `tool_call` (start, `"started"`, `completed`/`error`) cancels that call's
 *   pending flush and snapshot — a trailing flush firing after the terminal would regress the
 *   card from `completed` back to `running`;
 * - a turn terminal (`turn_completed`/`turn_failed`/`turn_canceled`) cancels every pending flush,
 *   so nothing escapes after a turn ends or is aborted (`cancelAll` covers session close).
 *
 * Dropping intermediate snapshots is lossless for snapshot-style tools (bash sends accumulated
 * output); a delta-style tool would show its latest chunk — a documented degradation, not
 * reconciled here.
 *
 * The cap is measured in UTF-8 bytes (`Buffer.byteLength`) — the unit that bounds the wire frame —
 * and cut on a code-point boundary. Only partial snapshots are capped; a terminal event's output
 * is authoritative and passes through untouched.
 *
 * Clock and timers are injectable so tests assert timing without real waiting; the defaults read
 * the globals at call time so fake timers installed later are honoured.
 */

/** Minimum spacing between emitted partials of one call (≤5 broadcasts/s per tool call). */
export const PARTIAL_MIN_INTERVAL_MS = 200;

/** Largest tail (UTF-8 bytes) of a snapshot put on the wire; bounds relay frame size. */
export const PARTIAL_OUTPUT_CAP_BYTES = 65536;

type ToolCallEvent = Extract<AgentStreamEvent, { kind: "tool_call" }>;

/** Cancels a callback scheduled through {@link ToolOutputCoalescerOptions.schedule}. */
export type CancelTimer = () => void;

export interface ToolOutputCoalescerOptions {
  /** Receives each partial that survives throttling, tail-capped: synchronously on the leading
   *  edge, from a timer on the trailing edge. */
  deliver: (event: AgentStreamEvent) => void;
  /** Epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Runs `callback` after `delayMs` and returns its canceller; defaults to an unref'd
   *  `setTimeout`. */
  schedule?: (callback: () => void, delayMs: number) => CancelTimer;
}

export interface ToolOutputCoalescer {
  /**
   * Route one mapped event. Returns `true` when `event` is a partial the coalescer took over
   * (delivered now or later through `deliver`; the caller must neither record nor emit it) and
   * `false` for every other event, which the caller records and emits as usual — superseded
   * pending partials have already been cancelled.
   */
  accept(event: AgentStreamEvent): boolean;
  /** Cancel every pending flush and forget all per-call state (turn terminal, session close). */
  cancelAll(): void;
}

interface CallState {
  /** When this call's last partial was delivered. */
  lastEmit: number;
  /** Latest snapshot withheld by the interval, awaiting the trailing flush. */
  pending?: ToolCallEvent;
  /** Cancels the scheduled trailing flush; set exactly while `pending` is. */
  cancelFlush?: CancelTimer;
}

/** One shared bucket for events without a `callId`; partial and terminal must agree on the key. */
function callKey(event: ToolCallEvent): string {
  return event.callId ?? "";
}

/** The last `maxBytes` UTF-8 bytes of `text`, starting on a code-point boundary. */
function tailWithinBytes(text: string, maxBytes: number): string {
  // UTF-8 spends at most 3 bytes per UTF-16 code unit, so a short string cannot exceed the cap.
  if (text.length * 3 <= maxBytes || Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const bytes = Buffer.from(text, "utf8");
  let start = bytes.length - maxBytes;
  // Skip UTF-8 continuation bytes (0b10xxxxxx) so the cut never splits a character.
  while (start < bytes.length && (bytes.readUInt8(start) & 0xc0) === 0x80) start++;
  return bytes.toString("utf8", start);
}

function withTailCap(event: ToolCallEvent): ToolCallEvent {
  const output = event.tool.output;
  if (output === undefined) return event;
  const tail = tailWithinBytes(output, PARTIAL_OUTPUT_CAP_BYTES);
  return tail === output ? event : { ...event, tool: { ...event.tool, output: tail } };
}

function scheduleTimeout(callback: () => void, delayMs: number): CancelTimer {
  const handle = setTimeout(callback, delayMs);
  // A pending flush must never keep the daemon alive.
  handle.unref();
  return () => clearTimeout(handle);
}

export function createToolOutputCoalescer(
  options: ToolOutputCoalescerOptions,
): ToolOutputCoalescer {
  const { deliver } = options;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? scheduleTimeout;
  const calls = new Map<string, CallState>();

  const flush = (state: CallState): void => {
    const event = state.pending;
    state.pending = undefined;
    state.cancelFlush = undefined;
    if (!event) return;
    state.lastEmit = now();
    deliver(withTailCap(event));
  };

  const offerPartial = (event: ToolCallEvent): void => {
    const key = callKey(event);
    const at = now();
    const state = calls.get(key);

    if (state && at - state.lastEmit < PARTIAL_MIN_INTERVAL_MS) {
      // Too soon: the latest snapshot supersedes any pending one; one flush per call is enough.
      state.pending = event;
      state.cancelFlush ??= schedule(
        () => flush(state),
        state.lastEmit + PARTIAL_MIN_INTERVAL_MS - at,
      );
      return;
    }

    // Leading edge. A flush may still be pending if its timer is running late — this snapshot is
    // newer than the pending one, so retire the flush instead of letting it deliver a stale one.
    state?.cancelFlush?.();
    calls.set(key, { lastEmit: at });
    deliver(withTailCap(event));
  };

  const cancelAll = (): void => {
    for (const state of calls.values()) state.cancelFlush?.();
    calls.clear();
  };

  return {
    accept(event: AgentStreamEvent): boolean {
      if (event.kind === "tool_call") {
        if (event.partial) {
          offerPartial(event);
          return true;
        }
        // Start, `"started"` or terminal: this call's partials are over — nothing pending may
        // outlive the event about to be emitted.
        const key = callKey(event);
        calls.get(key)?.cancelFlush?.();
        calls.delete(key);
        return false;
      }
      if (
        event.kind === "turn_completed" ||
        event.kind === "turn_failed" ||
        event.kind === "turn_canceled"
      ) {
        cancelAll();
      }
      return false;
    },
    cancelAll,
  };
}
