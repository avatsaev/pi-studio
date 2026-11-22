// The measuring parts of row B8 (a hidden window), apart from the page and the app so that they
// can be tested: chains of timers that record how late each fire was, and the clock of a paced
// stream, against which "how far behind the page is" is read.

/** The spec's timer (row B8): 500 ms. */
export const TIMER_MS = 500;
/** The page has caught up when it is this many frames (at 1,000 a second: this many milliseconds) behind the stream. */
export const CAUGHT_UP_LAG_FRAMES = 100;

/**
 * A chain of timers: each one is armed `intervalMs` after the previous one fired, as the app's
 * reconnect timers are, and records how late it fired (`delayMs`: the fire minus the time it was
 * due). `setTimer(callback, ms)` and `clearTimer(handle)` are the timers under test; `now()` is the
 * clock the delays are read on.
 */
export class TimerChain {
  #intervalMs;
  #now;
  #setTimer;
  #clearTimer;
  #handle = null;
  #stopped = true;
  #dueMs = 0;
  #final = null;
  samples = [];

  constructor({ intervalMs = TIMER_MS, now, setTimer, clearTimer }) {
    this.#intervalMs = intervalMs;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  start() {
    this.#stopped = false;
    this.#arm(this.#now());
  }

  /** Stops the chain; the timer that had not fired is remembered by `pending()`. */
  stop() {
    if (this.#stopped) return;
    this.#final = this.pending();
    this.#stopped = true;
    if (this.#handle !== null) this.#clearTimer(this.#handle);
    this.#handle = null;
  }

  /** The timer that has not fired: when it was due, and how late it is now (0 when it is not due yet); null when none. */
  pending() {
    if (this.#stopped) return this.#final;
    return { dueMs: this.#dueMs, lateMs: Math.max(0, this.#now() - this.#dueMs) };
  }

  #arm(from) {
    this.#dueMs = from + this.#intervalMs;
    this.#handle = this.#setTimer(() => this.#fire(), this.#intervalMs);
  }

  #fire() {
    if (this.#stopped) return;
    const at = this.#now();
    this.samples.push({ dueMs: this.#dueMs, atMs: at, delayMs: at - this.#dueMs });
    this.#arm(at);
  }
}

/**
 * What a chain did while the window was away, `fromMs` to `toMs` on the chain's clock.
 * - `expectedFires`: how many fires a timer that is not slowed would make.
 * - `firedWhileHidden`: the fires that happened in that period.
 * - `maxDelayMs`, `meanDelayMs`: the lateness of the fires that were due in that period, whenever
 *   they fired (a stopped timer fires late once the window is back), and of the timer still waiting
 *   if it was due in that period and has not fired.
 */
export function summarizeTimers(chain, fromMs, toMs) {
  const { samples } = chain;
  const due = samples.filter((s) => s.dueMs >= fromMs && s.dueMs <= toMs);
  const delays = due.map((s) => s.delayMs);
  const pending = chain.pending();
  if (pending && pending.dueMs >= fromMs && pending.dueMs <= toMs) delays.push(pending.lateMs);
  return {
    expectedFires: Math.floor((toMs - fromMs) / TIMER_MS),
    firedWhileHidden: samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs).length,
    dueWhileHidden: delays.length,
    maxDelayMs: delays.length ? Math.max(...delays) : null,
    meanDelayMs: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
    totalFires: samples.length,
  };
}

/** The clock of a paced stream: `rate` frames a second from `t0` (ms), `total` frames in all. */
export class StreamClock {
  constructor({ rate, total, t0 }) {
    this.rate = rate;
    this.total = total;
    this.t0 = t0;
  }

  /** How many frames the server has made by `now` (ms). */
  expected(now) {
    return Math.min(this.total, Math.max(0, Math.floor((this.rate * (now - this.t0)) / 1000)));
  }

  /** How many frames the page is behind at `now` having delivered `delivered`. */
  lag(delivered, now) {
    return Math.max(0, this.expected(now) - delivered);
  }
}

/** A trace of `{ atMs, delivered }`, in time order: the frames delivered by the last sample at or before `atMs`. */
export function deliveredAt(trace, atMs) {
  let found = 0;
  for (const sample of trace) {
    if (sample.atMs > atMs) break;
    found = sample.delivered;
  }
  return found;
}

/**
 * How long after `showMs` the page caught up: the first sample at or after it that is at most
 * `slack` frames behind. When the page never fell behind that far, 0. `null` when no sample after
 * the show is close enough (the caller then uses the end of the stream).
 */
export function catchUpMs(trace, clock, showMs, slack = CAUGHT_UP_LAG_FRAMES) {
  const before = trace.filter((s) => s.atMs <= showMs).at(-1);
  if (before && clock.lag(before.delivered, showMs) <= slack) return 0;
  const caught = trace.find((s) => s.atMs > showMs && clock.lag(s.delivered, s.atMs) <= slack);
  return caught ? caught.atMs - showMs : null;
}
